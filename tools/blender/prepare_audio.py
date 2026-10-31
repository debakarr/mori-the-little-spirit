"""Turn the downloaded CC0 audio (art/audio_src/) into small web loops in public/audio/.

Sources (all CC0, OpenGameArt):
  Forest_Ambience.mp3          music     TinyWorlds   https://opengameart.org/content/forest-ambience
  Birds_and_Wind_Ambient.ogg   ambience  Spring Spring https://opengameart.org/content/birds-and-wind-ambient-birds-wind-and-synth
  VistulaShort.mp3             water     RandomMind   https://opengameart.org/content/sea-and-river-wave-sounds

Run:  blender -b --factory-startup --python tools/blender/prepare_audio.py

Uses Blender's audio library (aud) since there is no ffmpeg on the machine. The water clip is cut to
40 s, its tail crossfaded into its head so it loops without a seam, softened and made mono.
"""
import aud, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, "art", "audio_src")
OUT = os.path.join(ROOT, "public", "audio")
os.makedirs(OUT, exist_ok=True)
RATE = 44100


def load(name, channels=2):
    s = aud.Sound(os.path.join(SRC, name)).resample(RATE, False)
    s = s.rechannel(channels)
    return s.data()  # (samples, channels) float32


def write(data, name, bitrate):
    snd = aud.Sound.buffer(np.ascontiguousarray(data, dtype=np.float32), RATE)
    path = os.path.join(OUT, name)
    snd.write(path, rate=RATE, channels=aud.CHANNELS_STEREO if data.shape[1] == 2 else aud.CHANNELS_MONO,
              format=aud.FORMAT_S16, container=aud.CONTAINER_MP3, codec=aud.CODEC_MP3, bitrate=bitrate)
    print("@@WROTE", name, round(len(data) / RATE, 1), "s", os.path.getsize(path) // 1024, "KB",
          "peak", round(float(np.abs(data).max()), 2), "rms", round(float(np.sqrt((data ** 2).mean())), 3))


def seamless(x, fade):
    """Crossfade the last `fade` samples into the first ones, then drop them: the end flows into the start."""
    t = np.linspace(0, 1, fade)[:, None]
    head = x[:fade] * np.sqrt(t) + x[-fade:] * np.sqrt(1 - t)
    return np.concatenate([head, x[fade:-fade]])


# music: already a seamless loop; it's mastered very quietly (peak 0.04), so normalise it
music = load("Forest_Ambience.mp3")
write(music * (0.5 / float(np.abs(music).max())), "music_forest.mp3", 128000)

# birds + wind bed
birds = load("Birds_and_Wind_Ambient.ogg")
write(seamless(birds, RATE * 2), "ambience_birds.mp3", 112000)

# water: 40 s from the calmest stretch of the recording, low-passed a touch so it reads as a small stream
water = load("VistulaShort.mp3", 1)
win = RATE * 40
step = RATE * 5
starts = range(RATE * 10, len(water) - win - RATE * 5, step)
rms = [float(np.sqrt((water[s:s + win] ** 2).mean())) for s in starts]
best = list(starts)[int(np.argmin(np.abs(np.array(rms) - np.median(rms))))]  # typical, not the loudest waves
clip = water[best:best + win + RATE * 3, 0].astype(np.float64)
k = np.exp(-2 * np.pi * 5200 / RATE)  # one-pole low-pass ~5 kHz
y = np.empty_like(clip)
acc = 0.0
for i, v in enumerate(clip):
    acc = (1 - k) * v + k * acc
    y[i] = acc
y = seamless(y[:, None], RATE * 3)
y *= 0.5 / max(float(np.abs(y).max()), 1e-6)
write(y, "stream_water.mp3", 96000)
