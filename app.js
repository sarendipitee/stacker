// Stacker Website Interactive Scripts & Audition Deck
const dialog = document.querySelector('#image-dialog');
function expandImage(src, alt) {
  const expanded = document.querySelector('#expanded-image');
  expanded.src = src;
  expanded.alt = alt;
  dialog.showModal();
}
document.querySelector('.image-button')?.addEventListener('click', (e) => {
  const img = e.currentTarget.querySelector('img');
  if (img) expandImage(img.src, img.alt);
});
document.querySelector('.dialog-close')?.addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

// Built-in Effects List Grid
const effects = [
  ['Multimode Filter', '#458aff', 'M8 15h15l14 20'],
  ['Parametric EQ', '#458aff', 'M6 32h7c6 0 4-20 11-20s5 20 11 20h7'],
  ['Comb Filter', '#458aff', 'M6 33l6-20 6 20 6-20 6 20 6-20 6 20'],
  ['Saturation / Distortion', '#458aff', 'M5 24h9l6-13 9 26 5-13h9'],
  ['Wavefolder', '#458aff', 'M5 32l9-19 10 19 10-19 9 19M5 16h38'],
  ['Bitcrusher', '#458aff', 'M6 35h7V25h8V15h8v10h8v10h6'],
  ['Delay', '#00e5ff', 'M22 24a8 12 0 1 1-16 0 8 12 0 1 1 16 0m10 0a8 12 0 1 1-16 0 8 12 0 1 1 16 0m10 0a8 12 0 1 1-16 0 8 12 0 1 1 16 0'],
  ['Algorithmic Reverb', '#00e5ff', 'M12 12h1m10 0h1m10 0h1M8 20h1m10 0h1m10 0h1m10 0h1M12 28h1m10 0h1m10 0h1M8 36h1m10 0h1m10 0h1m10 0h1'],
  ['Chorus', '#ba55ff', 'M5 32c5 0 2-18 7-18s2 18 7 18 2-18 7-18 2 18 7 18 2-18 7-18M5 27c5 0 2-18 7-18s2 18 7 18 2-18 7-18'],
  ['Flanger', '#ba55ff', 'M6 16c10-14 19 30 36 8M6 25c10-14 19 30 36 8M6 34c10-14 19 18 36-8'],
  ['Phaser', '#ba55ff', 'M6 24c8-28 17 28 26 0s10 0 10 0M6 24c8 28 17-28 26 0s10 0 10 0'],
  ['Tremolo', '#ba55ff', 'M5 24c6-22 13-22 19 0s13 22 19 0'],
  ['Auto-pan', '#ba55ff', 'M7 24h34M7 24l7-7m-7 7 7 7m27-7-7-7m7 7-7 7'],
  ['Ring Modulator', '#ba55ff', 'M38 24a14 14 0 1 1-28 0 14 14 0 1 1 28 0M15 15l18 18m0-18L15 33'],
  ['Frequency Shifter', '#ba55ff', 'M7 33c8-25 13-25 20-4M25 14h16v16m0-16L27 28'],
  ['Pitch Shifter', '#ba55ff', 'M18 7l-4 34m20-34-4 34M8 19h33M6 30h33'],
  ['Compressor', '#ffb731', 'M8 37l16-16h16M8 8v32h32'],
  ['Limiter', '#ffb731', 'M6 12h36M24 12v28'],
  ['Gate / Expander', '#ffb731', 'M5 35h12V13h14v22h12'],
  ['Transient Shaper', '#ffb731', 'M7 32h9l5-24 6 32 5-20 5 12h5'],
  ['Gain / Balance', '#ffb731', 'M12 15h24M24 5v20M12 36h24'],
  ['Stereo Utility', '#ffb731', 'M5 16h35m-8-7 8 7-8 7M43 33H8m8-7-8 7 8 7'],
];

const effectList = document.querySelector('#effect-list');
if (effectList) {
  effects.forEach(([name, color, glyph]) => {
    const item = document.createElement('div');
    item.className = 'effect-item';
    item.style.setProperty('--effect-color', color);
    const icon = document.createElement('span');
    icon.className = 'effect-glyph';
    icon.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', glyph);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    icon.append(svg);
    const label = document.createElement('span');
    label.textContent = name;
    item.append(icon, label);
    effectList.append(item);
  });
}

// -------------------------------------------------------------
// Audio Demos: Each row has independent Play + Dry/Wet toggle
// -------------------------------------------------------------
const demoSources = {
  comb: { dry: 'assets/demo-comb-dry.mp3', wet: 'assets/demo-comb-wet.mp3' },
  allpass: { dry: 'assets/demo-allpass-dry.mp3', wet: 'assets/demo-allpass-wet.mp3' },
  multiband: { dry: 'assets/demo-multiband-dry.mp3', wet: 'assets/demo-multiband-wet.mp3' }
};

class AudioPlayerRow {
  constructor(el) {
    this.el = el;
    this.key = el.dataset.demo;
    this.mode = 'wet'; // 'wet' or 'dry'
    this.isPlaying = false;

    this.audioDry = new Audio(demoSources[this.key].dry);
    this.audioWet = new Audio(demoSources[this.key].wet);
    this.audioDry.preload = 'auto';
    this.audioWet.preload = 'auto';
    this.audioDry.loop = true;
    this.audioWet.loop = true;

    this.playBtn = el.querySelector('.play-btn');
    this.playIcon = el.querySelector('.play-icon');
    this.toggleDry = el.querySelector('[data-mode="dry"]');
    this.toggleWet = el.querySelector('[data-mode="wet"]');
    this.progressBar = el.querySelector('.progress-bar-fill');
    this.progressContainer = el.querySelector('.playback-progress');
    this.timeReadout = el.querySelector('.time-readout');

    this.applyMode();
    this.bindEvents();
  }

  applyMode() {
    if (this.mode === 'wet') {
      this.audioWet.volume = 1.0;
      this.audioDry.volume = 0.0;
      this.toggleWet.classList.add('active');
      this.toggleWet.setAttribute('aria-pressed', 'true');
      this.toggleDry.classList.remove('active');
      this.toggleDry.setAttribute('aria-pressed', 'false');
    } else {
      this.audioWet.volume = 0.0;
      this.audioDry.volume = 1.0;
      this.toggleDry.classList.add('active');
      this.toggleDry.setAttribute('aria-pressed', 'true');
      this.toggleWet.classList.remove('active');
      this.toggleWet.setAttribute('aria-pressed', 'false');
    }
  }

  bindEvents() {
    this.playBtn.addEventListener('click', () => this.togglePlay());

    this.toggleDry.addEventListener('click', () => {
      this.mode = 'dry';
      this.audioDry.currentTime = this.audioWet.currentTime;
      this.applyMode();
    });

    this.toggleWet.addEventListener('click', () => {
      this.mode = 'wet';
      this.audioWet.currentTime = this.audioDry.currentTime;
      this.applyMode();
    });

    this.audioWet.addEventListener('timeupdate', () => {
      if (!this.isPlaying) return;
      const t = this.audioWet.currentTime;
      const dur = this.audioWet.duration || 4.0;
      const pct = Math.min(100, (t / dur) * 100);
      if (this.progressBar) this.progressBar.style.width = `${pct}%`;
      if (this.timeReadout) {
        const s = Math.floor(t % 60);
        this.timeReadout.textContent = `0:0${s}`;
      }
    });

    this.progressContainer.addEventListener('click', (e) => {
      const rect = this.progressContainer.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur = this.audioWet.duration || 4.0;
      const targetTime = ratio * dur;
      this.audioDry.currentTime = targetTime;
      this.audioWet.currentTime = targetTime;
    });
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      // Pause any other playing row
      allPlayers.forEach(p => { if (p !== this) p.pause(); });
      this.play();
    }
  }

  play() {
    this.audioDry.currentTime = this.audioWet.currentTime || 0;
    this.applyMode();
    Promise.all([this.audioDry.play(), this.audioWet.play()]).then(() => {
      this.isPlaying = true;
      this.playBtn.classList.add('playing');
      this.playIcon.textContent = '❚❚';
    }).catch(console.error);
  }

  pause() {
    this.audioDry.pause();
    this.audioWet.pause();
    this.isPlaying = false;
    this.playBtn.classList.remove('playing');
    this.playIcon.textContent = '▶';
  }
}

const allPlayers = [...document.querySelectorAll('.demo-row')].map(el => new AudioPlayerRow(el));

