const tracks = [
  {
    title: "Soft Signal", artist: "Dogmedia Demo", duration: 72, bpm: 92,
    colors: ["#b62c58", "#3b1636"],
    melody: [329.63, 392, 440, 392, 293.66, 329.63, 261.63, 293.66],
    bass: [110, 110, 98, 98, 87.31, 87.31, 98, 98],
  },
  {
    title: "Night Window", artist: "Dogmedia Demo", duration: 84, bpm: 104,
    colors: ["#825284", "#242648"],
    melody: [349.23, 440, 523.25, 440, 392, 349.23, 293.66, 392],
    bass: [116.54, 116.54, 130.81, 130.81, 98, 98, 87.31, 87.31],
  },
  {
    title: "Slow Orbit", artist: "Dogmedia Demo", duration: 66, bpm: 78,
    colors: ["#bd654c", "#4a2434"],
    melody: [261.63, 329.63, 392, 329.63, 246.94, 293.66, 349.23, 293.66],
    bass: [87.31, 87.31, 98, 98, 82.41, 82.41, 73.42, 73.42],
  },
];

const elements = {
  list: document.querySelector("#track-list"),
  title: document.querySelector("#now-title"),
  artist: document.querySelector("#now-artist"),
  number: document.querySelector("#track-number"),
  art: document.querySelector("#mini-art"),
  elapsed: document.querySelector("#elapsed"),
  duration: document.querySelector("#duration"),
  seek: document.querySelector("#seek"),
  volume: document.querySelector("#volume"),
  play: document.querySelector("#toggle-play"),
  previous: document.querySelector("#previous"),
  next: document.querySelector("#next"),
};

let selected = 0;
let playing = false;
let position = 0;
let startedAt = 0;
let nextStep = 0;
let audioContext;
let master;
let scheduler;
let animationFrame;
const liveOscillators = new Set();

function formatTime(seconds) {
  const whole = Math.floor(Math.max(0, seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function currentPosition() {
  return playing && audioContext ? position + audioContext.currentTime - startedAt : position;
}

function render() {
  const track = tracks[selected];
  elements.title.textContent = track.title;
  elements.artist.textContent = track.artist;
  elements.number.textContent = `${String(selected + 1).padStart(2, "0")} / ${String(tracks.length).padStart(2, "0")}`;
  elements.duration.textContent = formatTime(track.duration);
  elements.art.style.setProperty("--art-a", track.colors[0]);
  elements.art.style.setProperty("--art-b", track.colors[1]);
  elements.play.textContent = playing ? "Ⅱ" : "▶";
  elements.play.setAttribute("aria-label", playing ? "Jeda" : "Putar");
  elements.play.title = playing ? "Jeda" : "Putar";
  document.body.classList.toggle("is-playing", playing);
  [...elements.list.children].forEach((item, index) => {
    item.firstElementChild.classList.toggle("is-active", index === selected);
    item.firstElementChild.setAttribute("aria-current", index === selected ? "true" : "false");
  });
  renderProgress();
}

function renderProgress() {
  const elapsed = Math.min(currentPosition(), tracks[selected].duration);
  elements.elapsed.textContent = formatTime(elapsed);
  elements.seek.value = Math.round(elapsed / tracks[selected].duration * 1000);
}

function makeVoice(frequency, when, length, level, type = "sine") {
  const oscillator = audioContext.createOscillator();
  const envelope = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, when);
  envelope.gain.setValueAtTime(0.0001, when);
  envelope.gain.exponentialRampToValueAtTime(level, when + 0.025);
  envelope.gain.exponentialRampToValueAtTime(0.0001, when + length);
  oscillator.connect(envelope).connect(master);
  oscillator.onended = () => liveOscillators.delete(oscillator);
  liveOscillators.add(oscillator);
  oscillator.start(when);
  oscillator.stop(when + length + 0.01);
}

function stopVoices() {
  for (const oscillator of liveOscillators) {
    try { oscillator.stop(); } catch { /* Already stopped. */ }
  }
  liveOscillators.clear();
}

function scheduleAudio() {
  if (!playing || !audioContext) return;
  const track = tracks[selected];
  const beat = 60 / track.bpm;
  const now = audioContext.currentTime;
  const origin = startedAt - position;
  while (origin + nextStep * beat < now + 0.18 && nextStep * beat < track.duration) {
    const step = nextStep;
    const when = Math.max(now + 0.005, origin + step * beat);
    makeVoice(track.melody[step % track.melody.length], when, beat * 0.73, 0.19, "triangle");
    if (step % 2 === 0) makeVoice(track.bass[step % track.bass.length], when, beat * 1.4, 0.24);
    if (step % 4 === 0) makeVoice(55, when, 0.13, 0.3);
    nextStep += 1;
  }
}

function tick() {
  if (!playing) return;
  if (currentPosition() >= tracks[selected].duration) {
    selectTrack((selected + 1) % tracks.length, true);
    return;
  }
  renderProgress();
  animationFrame = requestAnimationFrame(tick);
}

async function play() {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
      master = audioContext.createGain();
      master.connect(audioContext.destination);
    }
    await audioContext.resume();
  } catch {
    elements.play.title = "Audio tidak tersedia di browser ini";
    return;
  }
  master.gain.value = (Number(elements.volume.value) / 100) ** 2 * 0.4;
  if (position >= tracks[selected].duration) position = 0;
  startedAt = audioContext.currentTime;
  nextStep = Math.ceil(position / (60 / tracks[selected].bpm));
  playing = true;
  scheduler = window.setInterval(scheduleAudio, 60);
  scheduleAudio();
  animationFrame = requestAnimationFrame(tick);
  render();
}

function pause() {
  if (!playing) return;
  position = Math.min(currentPosition(), tracks[selected].duration);
  playing = false;
  window.clearInterval(scheduler);
  cancelAnimationFrame(animationFrame);
  stopVoices();
  render();
}

function selectTrack(index, startPlaying = playing) {
  pause();
  selected = (index + tracks.length) % tracks.length;
  position = 0;
  render();
  if (startPlaying) play();
}

tracks.forEach((track, index) => {
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "track-row";
  button.setAttribute("aria-label", `Pilih ${track.title}`);
  const number = document.createElement("span");
  number.className = "track-index";
  number.textContent = String(index + 1).padStart(2, "0");
  const artwork = document.createElement("span");
  artwork.className = "track-art";
  artwork.setAttribute("aria-hidden", "true");
  artwork.style.setProperty("--art-a", track.colors[0]);
  artwork.style.setProperty("--art-b", track.colors[1]);
  const copy = document.createElement("span");
  copy.className = "track-copy";
  const title = document.createElement("span");
  title.className = "track-title";
  title.textContent = track.title;
  const artist = document.createElement("span");
  artist.className = "track-artist";
  artist.textContent = track.artist;
  copy.append(title, artist);
  const duration = document.createElement("span");
  duration.className = "track-duration";
  duration.textContent = formatTime(track.duration);
  const arrow = document.createElement("span");
  arrow.className = "track-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "↗";
  button.append(number, artwork, copy, duration, arrow);
  button.addEventListener("click", () => selectTrack(index, true));
  li.append(button);
  elements.list.append(li);
});

elements.play.addEventListener("click", () => playing ? pause() : play());
elements.previous.addEventListener("click", () => selectTrack(selected - 1));
elements.next.addEventListener("click", () => selectTrack(selected + 1));
elements.seek.addEventListener("input", () => {
  const resume = playing;
  pause();
  position = Number(elements.seek.value) / 1000 * tracks[selected].duration;
  renderProgress();
  if (resume) play();
});
elements.volume.addEventListener("input", () => {
  if (master) master.gain.value = (Number(elements.volume.value) / 100) ** 2 * 0.4;
});
window.addEventListener("pagehide", () => { pause(); audioContext?.close(); });
render();
