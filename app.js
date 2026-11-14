const video = document.getElementById('main-video');
const canvas = document.getElementById('gl-canvas');
const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
const container = document.getElementById('video-container');

const fileInput = document.getElementById('file-input');
const captureBtn = document.getElementById('capture-btn');
const roiBtn = document.getElementById('roi-btn');
const resetBtn = document.getElementById('reset-btn');
const playbackControls = document.getElementById('playback-controls');

const denoiseSlider = document.getElementById('denoise-slider');
const sharpSlider = document.getElementById('sharp-slider');
const zoomSlider = document.getElementById('zoom-slider');
const panXSlider = document.getElementById('pan-x-slider');
const panYSlider = document.getElementById('pan-y-slider');
const lightSlider = document.getElementById('light-slider');
const contrastSlider = document.getElementById('contrast-slider');

const monoCheck = document.getElementById('mono-check');
const invertCheck = document.getElementById('invert-check');
const flipCheck = document.getElementById('flip-check');

const overlay = document.getElementById('selection-overlay');
const selectionBox = document.getElementById('selection-box');

let isRoiActive = false;
let roiTransform = "";

const vsSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
    }
`;

const fsSource = `
    precision mediump float;
    uniform sampler2D u_image;
    uniform vec2 u_texSize;
    uniform float u_denoise;
    uniform float u_sharp;
    uniform float u_brightness;
    uniform float u_contrast;
    uniform bool u_mono;
    uniform bool u_invert;
    varying vec2 v_texCoord;

    void main() {
        vec2 onePixel = vec2(1.0, 1.0) / u_texSize;
        vec4 centerColor = texture2D(u_image, v_texCoord);

        vec4 denoised = centerColor;
        if (u_denoise > 0.0) {
            vec4 sum = vec4(0.0);
            float totalWeight = 0.0;
            for (int x = -1; x <= 1; x++) {
                for (int y = -1; y <= 1; y++) {
                    vec2 offset = vec2(float(x), float(y)) * onePixel;
                    vec4 sampleColor = texture2D(u_image, v_texCoord + offset);
                    float colorDiff = distance(centerColor.rgb, sampleColor.rgb);
                    float weight = exp(-colorDiff * (15.0 - u_denoise * 10.0));
                    sum += sampleColor * weight;
                    totalWeight += weight;
                }
            }
            denoised = sum / totalWeight;
        }

        vec4 finalColor = denoised;
        if (u_sharp > 0.0) {
            vec4 top = texture2D(u_image, v_texCoord + vec2(0.0, -onePixel.y));
            vec4 bottom = texture2D(u_image, v_texCoord + vec2(0.0, onePixel.y));
            vec4 left = texture2D(u_image, v_texCoord + vec2(-onePixel.x, 0.0));
            vec4 right = texture2D(u_image, v_texCoord + vec2(onePixel.x, 0.0));

            vec4 neighbors = (top + bottom + left + right) * 0.25;
            vec4 detail = denoised - neighbors;
            finalColor = denoised + detail * (u_sharp * 2.5);
        }

        finalColor.rgb *= u_brightness;
        finalColor.rgb = (finalColor.rgb - 0.5) * u_contrast + 0.5;

        if (u_mono) {
            float gray = dot(finalColor.rgb, vec3(0.299, 0.587, 0.114));
            finalColor.rgb = vec3(gray);
        }
        if (u_invert) {
            finalColor.rgb = 1.0 - finalColor.rgb;
        }

        gl_FragColor = vec4(clamp(finalColor.rgb, 0.0, 1.0), 1.0);
    }
`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
}

const program = gl.createProgram();
gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vsSource));
gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
gl.linkProgram(program);
gl.useProgram(program);

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
const posLoc = gl.getAttribLocation(program, "a_position");
gl.enableVertexAttribArray(posLoc);
gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

const texCoordBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]), gl.STATIC_DRAW);
const texLoc = gl.getAttribLocation(program, "a_texCoord");
gl.enableVertexAttribArray(texLoc);
gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

function renderLoop() {
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            gl.viewport(0, 0, canvas.width, canvas.height);
        }

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

        gl.uniform2f(gl.getUniformLocation(program, "u_texSize"), canvas.width, canvas.height);
        gl.uniform1f(gl.getUniformLocation(program, "u_denoise"), parseFloat(denoiseSlider.value));
        gl.uniform1f(gl.getUniformLocation(program, "u_sharp"), parseFloat(sharpSlider.value));
        gl.uniform1f(gl.getUniformLocation(program, "u_brightness"), parseFloat(lightSlider.value) / 100.0);
        gl.uniform1f(gl.getUniformLocation(program, "u_contrast"), parseFloat(contrastSlider.value) / 100.0);
        gl.uniform1i(gl.getUniformLocation(program, "u_mono"), monoCheck.checked ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(program, "u_invert"), invertCheck.checked ? 1 : 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        video.src = URL.createObjectURL(file);
        playbackControls.style.display = "flex";
        video.play();
    }
});

captureBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always" },
            audio: false
        });
        video.src = "";
        video.srcObject = stream;
        playbackControls.style.display = "none";
        video.play();
    } catch (err) {
        console.log("تم إلغاء التقاط الشاشة");
    }
});

document.getElementById('play-pause-btn').onclick = () => video.paused ? video.play() : video.pause();
document.getElementById('step-back-btn').onclick = () => video.currentTime = Math.max(0, video.currentTime - 5);
document.getElementById('step-fwd-btn').onclick = () => video.currentTime = Math.min(video.duration, video.currentTime + 5);

function updateUIAndTransform() {
    document.getElementById('denoise-val').innerText = Math.round(denoiseSlider.value * 100) + "%";
    document.getElementById('sharp-val').innerText = Math.round((sharpSlider.value / 2) * 100) + "%";
    document.getElementById('z-val').innerText = parseFloat(zoomSlider.value).toFixed(1) + "x";
    document.getElementById('x-val').innerText = panXSlider.value + "px";
    document.getElementById('y-val').innerText = panYSlider.value + "px";
    document.getElementById('light-val').innerText = lightSlider.value + "%";
    document.getElementById('contrast-val').innerText = contrastSlider.value + "%";

    const zoom = zoomSlider.value;
    const panX = panXSlider.value;
    const panY = panYSlider.value;
    const flipScale = flipCheck.checked ? -1 : 1;

    if (!isRoiActive) {
        canvas.style.transformOrigin = "center center";
        canvas.style.transform = `scale(${zoom * flipScale}, ${zoom}) translate(${panX}px, ${panY}px)`;
    } else {
        canvas.style.transform = `${roiTransform} scaleX(${flipScale})`;
    }
}

[denoiseSlider, sharpSlider, lightSlider, contrastSlider, monoCheck, invertCheck, flipCheck].forEach(el => {
    el.addEventListener('input', updateUIAndTransform);
    el.addEventListener('change', updateUIAndTransform);
});

[zoomSlider, panXSlider, panYSlider].forEach(el => {
    el.addEventListener('input', () => {
        isRoiActive = false;
        updateUIAndTransform();
    });
});

let startX, startY, isDrawing = false;

roiBtn.addEventListener('click', () => {
    isRoiActive = false;
    canvas.style.transform = "none";
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

    canvas.style.transformOrigin = "center center";
    roiTransform = `scale(${targetScale}) translate(${translateX}px, ${translateY}px)`;
    updateUIAndTransform();
});

function resetAll() {
    isRoiActive = false;
    overlay.style.display = "none";
    selectionBox.style.display = "none";
    
    denoiseSlider.value = 0;
    sharpSlider.value = 0;
    zoomSlider.value = 1;
    panXSlider.value = 0;
    panYSlider.value = 0;
    lightSlider.value = 100;
    contrastSlider.value = 100;
    monoCheck.checked = false;
    invertCheck.checked = false;
    flipCheck.checked = false;
    
    updateUIAndTransform();
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
            updateUIAndTransform();
        }
    }
});
