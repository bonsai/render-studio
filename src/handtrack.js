/**
 * MediaPipe Hand Tracking → u_mouse uniform bridge.
 * Usage: import { initHandTrack } from './src/handtrack.js';
 *        initHandTrack(uniforms, { onFrame });
 *
 * Adds a floating "✋" toggle button in bottom-right.
 * Camera only activates when user clicks the button.
 * Maps index finger tip (landmark 8) to canvas pixel coords.
 */

export function initHandTrack(uniforms, opts = {}) {
  const onFrame = opts.onFrame || (() => {});

  // Lazy-load MediaPipe
  const script1 = document.createElement('script');
  script1.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
  script1.crossOrigin = 'anonymous';
  const script2 = document.createElement('script');
  script2.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
  script2.crossOrigin = 'anonymous';

  // Toggle button
  const btn = document.createElement('button');
  btn.textContent = '✋';
  btn.title = 'MediaPipe Hand Tracking';
  Object.assign(btn.style, {
    position: 'fixed', bottom: '12px', right: '12px', zIndex: 10000,
    width: '44px', height: '44px', borderRadius: '50%', border: '2px solid #333',
    background: '#1a1a1a', color: '#fff', fontSize: '20px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  });
  document.body.appendChild(btn);

  // Video element (hidden)
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  Object.assign(video.style, { display: 'none' });
  document.body.appendChild(video);

  // Canvas for hand landmarks overlay
  const overlay = document.createElement('canvas');
  overlay.id = 'hand-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: 9999,
  });
  document.body.appendChild(overlay);
  const octx = overlay.getContext('2d');

  let active = false;
  let camera = null;
  let hands = null;

  function resizeOverlay() {
    overlay.width = window.innerWidth;
    overlay.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeOverlay);
  resizeOverlay();

  function drawLandmarks(landmarks) {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (!landmarks || landmarks.length === 0) return;

    const lm = landmarks[0]; // first hand
    const w = overlay.width;
    const h = overlay.height;

    // Draw connections
    const connections = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],
      [9,13],[13,14],[14,15],[15,16],
      [13,17],[17,18],[18,19],[19,20],[0,17],
    ];

    octx.strokeStyle = 'rgba(0,200,255,0.6)';
    octx.lineWidth = 2;
    for (const [a, b] of connections) {
      octx.beginPath();
      octx.moveTo(lm[a].x * w, lm[a].y * h);
      octx.lineTo(lm[b].x * w, lm[b].y * h);
      octx.stroke();
    }

    // Draw joints
    for (let i = 0; i < lm.length; i++) {
      const x = lm[i].x * w;
      const y = lm[i].y * h;
      octx.beginPath();
      octx.arc(x, y, i === 8 ? 5 : 3, 0, Math.PI * 2);
      octx.fillStyle = i === 8 ? '#00ff88' : 'rgba(0,200,255,0.9)';
      octx.fill();
    }
  }

  function onResults(results) {
    const lm = results.multiHandLandmarks;
    drawLandmarks(lm);

    if (lm && lm.length > 0) {
      // Index finger tip = landmark 8
      // Map to pixel coordinates
      const hand = lm[0];
      const x = hand[8].x * window.innerWidth;
      const y = hand[8].y * window.innerHeight;

      if (uniforms && uniforms.u_mouse) {
        uniforms.u_mouse.value.set(x, window.innerHeight - y);
      }
      onFrame({ x, y, landmarks: hand });
    }
  }

  async function start() {
    if (active) return;
    active = true;
    btn.style.borderColor = '#00c8ff';
    btn.style.boxShadow = '0 0 12px rgba(0,200,255,0.4)';

    // Load scripts sequentially
    if (!window.Hands) {
      await new Promise((resolve) => {
        script1.onload = () => {
          script2.onload = resolve;
          document.head.appendChild(script2);
        };
        document.head.appendChild(script1);
      });
    }

    hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });
    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    hands.onResults(onResults);

    camera = new window.Camera(video, {
      onFrame: async () => {
        if (hands) await hands.send({ image: video });
      },
      width: 640,
      height: 480,
    });
    camera.start();
  }

  function stop() {
    if (!active) return;
    active = false;
    btn.style.borderColor = '#333';
    btn.style.boxShadow = 'none';
    if (camera) { camera.stop(); camera = null; }
    hands = null;
    octx.clearRect(0, 0, overlay.width, overlay.height);
  }

  btn.addEventListener('click', () => {
    if (active) stop(); else start();
  });

  if (opts.autoStart) start();

  return { start, stop, isActive: () => active };
}
