const video = document.getElementById('main-video');
const canvas = document.getElementById('gl-canvas');
const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });

const fileInput = document.getElementById('file-input');
const captureBtn = document.getElementById('capture-btn');
const resetBtn = document.getElementById('reset-btn');

const zoomSlider = document.getElementById('zoom-slider');
const panXSlider = document.getElementById('pan-x-slider');
const panYSlider = document.getElementById('pan-y-slider');
const smoothSlider = document.getElementById('smooth-slider');
const sharpSlider = document.getElementById('sharp-slider');
const lightSlider = document.getElementById('light-slider');

const monoCheck = document.getElementById('mono-check');
const invertCheck = document.getElementById('invert-check');
const flipCheck = document.getElementById('flip-check');

// --- إعداد محرك منع التفكك البكسلي (Bicubic Interpolation + Edge Preservation) ---
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
    uniform float u_smooth;
    uniform float u_sharp;
    uniform float u_brightness;
    uniform bool u_mono;
    uniform bool u_invert;
    varying vec2 v_texCoord;

    vec4 textureBicubic(sampler2D sampler, vec2 texCoords) {
        vec2 texSize = u_texSize;
        vec2 invTexSize = 1.0 / texSize;
        texCoords = texCoords * texSize - 0.5;
        vec2 fxy = fract(texCoords);
        texCoords -= fxy;

        vec4 xcubic = vec4(
            (1.0 - fxy.x) * (1.0 - fxy.x) * (1.0 - fxy.x) / 6.0,
            (3.0 * fxy.x * fxy.x * fxy.x - 6.0 * fxy.x * fxy.x + 4.0) / 6.0,
            (-3.0 * fxy.x * fxy.x * fxy.x + 3.0 * fxy.x * fxy.x + 3.0 * fxy.x + 1.0) / 6.0,
            fxy.x * fxy.x * fxy.x / 6.0
        );
        vec4 ycubic = vec4(
            (1.0 - fxy.y) * (1.0 - fxy.y) * (1.0 - fxy.y) / 6.0,
            (3.0 * fxy.y * fxy.y * fxy.y - 6.0 * fxy.y * fxy.y + 4.0) / 6.0,
            (-3.0 * fxy.y * fxy.y * fxy.y + 3.0 * fxy.y * fxy.y + 3.0 * fxy.y + 1.0) / 6.0,
            fxy.y * fxy.y * fxy.y / 6.0
        );

        vec4 c = texCoords.xxyy + vec2(-0.5, 1.5).xyxy;
        vec4 s = vec4(xcubic.xz + xcubic.yw, ycubic.xz + ycubic.yw);
        vec4 offset = c + vec4(xcubic.yw, ycubic.yw) / s;
        offset *= invTexSize.xxyy;

        vec4 sample0 = texture2D(sampler, offset.xz);
        vec4 sample1 = texture2D(sampler, offset.yz);
        vec4 sample2 = texture2D(sampler, offset.xw);
        vec4 sample3 = texture2D(sampler, offset.yw);

        float sx = s.x / (s.x + s.y);
        float sy = s.z / (s.z + s.w);

        return mix(mix(sample3, sample2, sx), mix(sample1, sample0, sx), sy);
    }

    void main() {
        vec4 rawColor = texture2D(u_image, v_texCoord);
        vec4 bicubicColor = textureBicubic(u_image, v_texCoord);
        
        vec4 baseColor = mix(rawColor, bicubicColor, u_smooth);

        vec2 onePixel = 1.0 / u_texSize;
        vec4 top = texture2D(u_image, v_texCoord + vec2(0.0, -onePixel.y));
        vec4 bottom = texture2D(u_image, v_texCoord + vec2(0.0, onePixel.y));
        vec4 left = texture2D(u_image, v_texCoord + vec2(-onePixel.x, 0.0));
        vec4 right = texture2D(u_image, v_texCoord + vec2(onePixel.x, 0.0));
        
        vec4 edgeDetail = baseColor - ((top + bottom + left + right) * 0.25);
        vec4 finalColor = baseColor + edgeDetail * u_sharp;

        finalColor.rgb *= u_brightness;
        float contrastFactor = 1.0 + (u_sharp * 0.15);
        finalColor.rgb = (finalColor.rgb - 0.5) * contrastFactor + 0.5;

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
        gl.uniform1f(gl.getUniformLocation(program, "u_smooth"), parseFloat(smoothSlider.value) / 100.0);
        gl.uniform1f(gl.getUniformLocation(program, "u_sharp"), parseFloat(sharpSlider.value) * 0.25);
        gl.uniform1f(gl.getUniformLocation(program, "u_brightness"), parseFloat(lightSlider.value) / 100.0);
        gl.uniform1i(gl.getUniformLocation(program, "u_mono"), monoCheck.checked ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(program, "u_invert"), invertCheck.checked ? 1 : 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

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

// 2. التقاط نافذة أو شاشة من الكمبيوتر بأعلى دقة
captureBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
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
    const smooth = smoothSlider.value;
    const light = lightSlider.value;
    const sharp = sharpSlider.value;

    document.getElementById('z-val').innerText = parseFloat(zoom).toFixed(1) + "x";
    document.getElementById('x-val').innerText = panX + "px";
    document.getElementById('y-val').innerText = panY + "px";
    document.getElementById('smooth-val').innerText = smooth + "%";
    document.getElementById('light-val').innerText = light + "%";
    document.getElementById('sharp-val').innerText = "+" + (sharp * 15) + "%";

    const flipScale = flipCheck.checked ? -1 : 1;

    canvas.style.transformOrigin = "center center";
    canvas.style.transform = `scale(${zoom * flipScale}, ${zoom}) translate(${panX}px, ${panY}px)`;
}

[zoomSlider, panXSlider, panYSlider, smoothSlider, lightSlider, sharpSlider, monoCheck, invertCheck, flipCheck].forEach(el => {
    el.addEventListener('input', updateVideoEffects);
    el.addEventListener('change', updateVideoEffects);
});

// 4. إعادة الضبط
function resetAll() {
    zoomSlider.value = 1;
    panXSlider.value = 0;
    panYSlider.value = 0;
    smoothSlider.value = 50;
    lightSlider.value = 100;
    sharpSlider.value = 0;
    monoCheck.checked = false;
    invertCheck.checked = false;
    flipCheck.checked = false;
    
    updateVideoEffects();
}

resetBtn.addEventListener('click', resetAll);
