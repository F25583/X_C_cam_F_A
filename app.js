const video = document.getElementById('main-video');
const container = document.getElementById('video-container');
const fileInput = document.getElementById('file-input');
const captureBtn = document.getElementById('capture-btn');
const roiBtn = document.getElementById('roi-btn');
const resetBtn = document.getElementById('reset-btn');

const zoomSlider = document.getElementById('zoom-slider');
const panXSlider = document.getElementById('pan-x-slider');
const panYSlider = document.getElementById('pan-y-slider');
const lightSlider = document.getElementById('light-slider');
const sharpSlider = document.getElementById('sharp-slider');

const monoCheck = document.getElementById('mono-check');
const invertCheck = document.getElementById('invert-check');
const flipCheck = document.getElementById('flip-check');

const overlay = document.getElementById('selection-overlay');
const selectionBox = document.getElementById('selection-box');

let isRoiActive = false;
let roiTransform = "";

// 1. تشغيل ملف فيديو من الجهاز
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        video.src = URL.createObjectURL(file);
        video.play();
    }
});

// 2. التقاط نافذة أو شاشة من الكمبيوتر
captureBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always" },
            audio: false
        });
        video.src = "";
        video.srcObject = stream;
        video.play();
    } catch (err) {
        console.log("تم إلغاء التقاط الشاشة");
    }
});

// 3. تطبيق الفلاتر والتحجيم
function updateVideoEffects() {
    const zoom = zoomSlider.value;
    const panX = panXSlider.value;
    const panY = panYSlider.value;
    const light = lightSlider.value;
    const sharp = sharpSlider.value;

    document.getElementById('z-val').innerText = parseFloat(zoom).toFixed(1) + "x";
    document.getElementById('x-val').innerText = panX + "px";
    document.getElementById('y-val').innerText = panY + "px";
    document.getElementById('light-val').innerText = light + "%";
    document.getElementById('sharp-val').innerText = "+" + (sharp * 15) + "%";

    const flipScale = flipCheck.checked ? -1 : 1;

    if (!isRoiActive) {
        video.style.transformOrigin = "center center";
        video.style.transform = `scale(${zoom * flipScale}, ${zoom}) translate(${panX}px, ${panY}px)`;
    } else {
        video.style.transform = `${roiTransform} scaleX(${flipScale})`;
    }

    const contrast = 100 + (sharp * 15);
    const saturate = monoCheck.checked ? 0 : (110 + parseInt(sharp * 2));
    const invert = invertCheck.checked ? 100 : 0;

    video.style.filter = `brightness(${light}%) contrast(${contrast}%) saturate(${saturate}%) invert(${invert}%)`;
}

// ربط الأحداث
[zoomSlider, panXSlider, panYSlider].forEach(el => {
    el.addEventListener('input', () => {
        isRoiActive = false;
        updateVideoEffects();
    });
});

[lightSlider, sharpSlider, monoCheck, invertCheck, flipCheck].forEach(el => {
    el.addEventListener('input', updateVideoEffects);
    el.addEventListener('change', updateVideoEffects);
});

// 4. ميزة التحديد بالماوس (ROI Selection)
let startX, startY, isDrawing = false;

roiBtn.addEventListener('click', () => {
    isRoiActive = false;
    video.style.transform = "none";
    overlay.style.display = "block";
});

overlay.addEventListener('mousedown', (e) => {
    isDrawing = true;
    const rect = overlay.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    selectionBox.style.left = startX + "px";
    selectionBox.style.top = startY + "px";
    selectionBox.style.width = "0px";
    selectionBox.style.height = "0px";
    selectionBox.style.display = "block";
});

overlay.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const rect = overlay.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    selectionBox.style.width = Math.abs(currentX - startX) + "px";
    selectionBox.style.height = Math.abs(currentY - startY) + "px";
    selectionBox.style.left = Math.min(currentX, startX) + "px";
    selectionBox.style.top = Math.min(currentY, startY) + "px";
});

overlay.addEventListener('mouseup', () => {
    if (!isDrawing) return;
    isDrawing = false;
    overlay.style.display = "none";

    const boxRect = selectionBox.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();
    selectionBox.style.display = "none";

    if (boxRect.width < 20 || boxRect.height < 20) return;

    isRoiActive = true;
    const scaleX = contRect.width / boxRect.width;
    const scaleY = contRect.height / boxRect.height;
    const targetScale = Math.min(scaleX, scaleY, 10);

    const boxCenterX = (boxRect.left - contRect.left) + (boxRect.width / 2);
    const boxCenterY = (boxRect.top - contRect.top) + (boxRect.height / 2);

    const translateX = (contRect.width / 2) - boxCenterX;
    const translateY = (contRect.height / 2) - boxCenterY;

    video.style.transformOrigin = "center center";
    roiTransform = `scale(${targetScale}) translate(${translateX}px, ${translateY}px)`;
    updateVideoEffects();
});

// 5. إعادة الضبط وزر Escape
function resetAll() {
    isRoiActive = false;
    overlay.style.display = "none";
    selectionBox.style.display = "none";
    
    zoomSlider.value = 1;
    panXSlider.value = 0;
    panYSlider.value = 0;
    lightSlider.value = 100;
    sharpSlider.value = 0;
    monoCheck.checked = false;
    invertCheck.checked = false;
    flipCheck.checked = false;
    
    updateVideoEffects();
}

resetBtn.addEventListener('click', resetAll);

document.addEventListener('keydown', (e) => {
    if (e.key === "Escape") {
        if (isRoiActive || overlay.style.display === "block") {
            isRoiActive = false;
            overlay.style.display = "none";
            selectionBox.style.display = "none";
            zoomSlider.value = 1;
            panXSlider.value = 0;
            panYSlider.value = 0;
            updateVideoEffects();
        }
    }
});
