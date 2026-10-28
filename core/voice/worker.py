# Працэс сінтэзу маўлення для Tadewusz: OmniVoice загружаецца адзін раз і застаецца ў памяці (відэакарты або RAM).
# Налады — праз асяроддзе: TADEWUSZ_VOICE_DEVICE (cpu | cuda), TADEWUSZ_VOICE_STEPS (16 | 32).
# Запускае ядро (core/voice/voice.js) праз python.exe з асяроддзя OmniVoice — без акна кансолі.
# Пратакол: па адным JSON у радку.
#   stdin:  {"id": "...", "text": "...", "instruct": "...", "speed": 1.0, "out": "C:\\...\\id.wav"}
#   stdout: {"event": "ready", "device": "cuda:0", "vram_mb": 2100, "ram_mb": 900, "load_ms": 40000} · {"id": "...", "ok": true, "ms": 4210} · {"id": "...", "ok": false, "error": "..."}
# Калі ядро закрывае stdin (OBS закрыўся або ядро спынілася), працэс завяршаецца сам.
import json
import os
import sys
import time

# Канал адказаў — асобная копія stdout; усё астатняе (логі torch, transformers, tqdm) ідзе ў stderr,
# каб чужы друк не зламаў пратакол.
proto = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr
sys.stdin.reconfigure(encoding="utf-8")


def send(message):
    proto.write(json.dumps(message, ensure_ascii=False) + "\n")
    proto.flush()


def vram_mb(torch, cuda):
    # Колькі відэапамяці трымае PyTorch (пік пасля прагрэву).
    return int(torch.cuda.max_memory_reserved() / 2**20) if cuda else 0


def ram_mb():
    # Рабочы набор працэсу (Windows); без psutil.
    try:
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in (
                    "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
                    "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]

        counters = Counters()
        counters.cb = ctypes.sizeof(Counters)
        kernel32, psapi = ctypes.windll.kernel32, ctypes.windll.psapi
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD]
        if psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            return int(counters.WorkingSetSize / 2**20)
    except Exception:  # noqa: BLE001 — не Windows або няма psapi
        pass
    return None


def main():
    try:
        # Час загрузкі — разам з імпартам бібліятэк: ён займае ад 10 да 45 с.
        loading = time.time()
        import torch
        import soundfile as sf
        from omnivoice import OmniVoice

        cuda = os.environ.get("TADEWUSZ_VOICE_DEVICE", "cuda") == "cuda" and torch.cuda.is_available()
        device = "cuda:0" if cuda else "cpu"
        if not cuda:
            # Палова ядраў: гульня і OBS не павінны застацца без працэсара.
            torch.set_num_threads(max(2, (os.cpu_count() or 4) // 2))
        steps = int(os.environ.get("TADEWUSZ_VOICE_STEPS", "16"))
        model = OmniVoice.from_pretrained(
            "k2-fsa/OmniVoice", device_map=device, dtype=torch.float16 if cuda else torch.float32
        )
        rate = model.sampling_rate or 24000
        # Першы сінтэз павольны (кампіляцыя ядраў CUDA) — робім яго адразу, а не на паведамленні гледача.
        model.generate(text="Праверка голасу перад эфірам.", language="be", num_step=steps)
    except Exception as error:  # noqa: BLE001 — любая памылка загрузкі ідзе ў ядро
        send({"event": "failed", "error": f"{type(error).__name__}: {error}"[:300]})
        return 1

    send({"event": "ready", "device": device, "vram_mb": vram_mb(torch, cuda), "ram_mb": ram_mb(),
          "load_ms": int((time.time() - loading) * 1000)})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        job = {}
        try:
            job = json.loads(line)
            started = time.time()
            audio = model.generate(
                text=job["text"],
                language="be",
                instruct=job.get("instruct") or None,
                speed=float(job.get("speed") or 1.0),
                num_step=steps,
            )
            samples = audio[0]
            out = job["out"]
            tmp = out + ".part"
            sf.write(tmp, samples, rate, format="WAV", subtype="PCM_16")
            os.replace(tmp, out)
            send({
                "id": job["id"], "ok": True, "ms": int(len(samples) * 1000 / rate),
                "took": int((time.time() - started) * 1000),
            })
        except Exception as error:  # noqa: BLE001 — адно няўдалае паведамленне не спыняе працэс
            send({"id": job.get("id"), "ok": False, "error": f"{type(error).__name__}: {error}"[:300]})
    return 0


if __name__ == "__main__":
    sys.exit(main())
