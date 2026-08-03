#!/usr/bin/env python3
"""
AI Video Clipper — Pre-Flight Environment Checker
Run this before starting the application to verify all dependencies.

Usage:
    python verify_env.py
"""

import sys
import os
import shutil
import subprocess
import importlib
from pathlib import Path

# Fix Windows console encoding for Unicode characters
if sys.platform == "win32":
    os.system("")  # Enable ANSI escape sequences on Windows 10+
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# ANSI color codes for terminal output
class Colors:
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    BOLD = "\033[1m"
    RESET = "\033[0m"


def ok(msg: str) -> str:
    return f"  {Colors.GREEN}✓{Colors.RESET} {msg}"


def warn(msg: str) -> str:
    return f"  {Colors.YELLOW}⚠{Colors.RESET} {msg}"


def fail(msg: str) -> str:
    return f"  {Colors.RED}✗{Colors.RESET} {msg}"


def header(msg: str) -> str:
    return f"\n{Colors.BOLD}{Colors.CYAN}── {msg} ──{Colors.RESET}"


def check_python_version() -> bool:
    """Check Python version >= 3.10."""
    v = sys.version_info
    version_str = f"{v.major}.{v.minor}.{v.micro}"
    if v.major == 3 and v.minor >= 10:
        print(ok(f"Python {version_str}"))
        return True
    else:
        print(fail(f"Python {version_str} — requires >= 3.10"))
        return False


def check_ffmpeg() -> bool:
    """Check FFmpeg is installed and has libass support."""
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        print(fail("FFmpeg not found in PATH"))
        print(f"       Install from: https://ffmpeg.org/download.html")
        return False

    print(ok(f"FFmpeg found: {ffmpeg_path}"))

    # Check version
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True, text=True, timeout=10
        )
        first_line = result.stdout.split("\n")[0]
        print(ok(f"  {first_line}"))

        # Check for libass support (critical for .ass subtitle burn-in)
        full_output = result.stdout
        if "--enable-libass" in full_output:
            print(ok("  libass support: enabled"))
        else:
            print(warn("  libass support: NOT FOUND — subtitle burn-in may fail"))
            print(f"       You need an FFmpeg build with --enable-libass")
            return False

        # Check for libx264 (H.264 encoding)
        if "--enable-libx264" in full_output:
            print(ok("  libx264 support: enabled"))
        else:
            print(warn("  libx264 support: NOT FOUND — may fallback to other encoder"))

        return True
    except Exception as e:
        print(warn(f"  Could not verify FFmpeg features: {e}"))
        return True  # FFmpeg exists, just can't verify features


def check_pip_packages() -> tuple[list, list]:
    """Check all required pip packages."""
    required_packages = [
        ("fastapi", "fastapi"),
        ("uvicorn", "uvicorn"),
        ("yt_dlp", "yt-dlp"),
        ("openai", "openai"),
        ("dotenv", "python-dotenv"),
        ("pydantic", "pydantic"),
        ("aiofiles", "aiofiles"),
        ("sse_starlette", "sse-starlette"),
    ]

    installed = []
    missing = []

    for import_name, pip_name in required_packages:
        try:
            mod = importlib.import_module(import_name)
            version = getattr(mod, "__version__", "unknown")
            print(ok(f"{pip_name} ({version})"))
            installed.append(pip_name)
        except ImportError:
            print(fail(f"{pip_name} — NOT INSTALLED"))
            missing.append(pip_name)

    return installed, missing


def check_api_keys() -> bool:
    """Check that required API keys are configured."""
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")

    all_ok = True

    # DeepSeek API key
    deepseek_key = os.getenv("DEEPSEEK_API_KEY", "")
    if deepseek_key and deepseek_key != "your_deepseek_api_key_here":
        print(ok(f"DeepSeek API key: configured ({deepseek_key[:8]}...)"))
    else:
        print(fail("DeepSeek API key: NOT SET — add DEEPSEEK_API_KEY to .env"))
        all_ok = False

    # Groq API key (for Whisper transcription)
    groq_key = os.getenv("GROQ_API_KEY", "")
    if groq_key and groq_key != "your_groq_api_key_here":
        print(ok(f"Groq API key: configured ({groq_key[:8]}...)"))
    else:
        print(fail("Groq API key: NOT SET — add GROQ_API_KEY to .env"))
        all_ok = False

    return all_ok


def check_env_file() -> bool:
    """Check if .env file exists."""
    env_path = Path(__file__).parent / ".env"
    example_path = Path(__file__).parent / ".env.example"

    if env_path.exists():
        print(ok(".env file found"))
        return True
    elif example_path.exists():
        print(warn(".env file not found — copying from .env.example"))
        import shutil
        shutil.copy2(example_path, env_path)
        print(ok("  Created .env from .env.example — edit it to add your API keys"))
        return True
    else:
        print(warn(".env file not found and no .env.example to copy from"))
        return False


def check_directories() -> bool:
    """Ensure output directories exist."""
    base_dir = Path(__file__).parent
    dirs = ["downloads", "outputs", "temp"]
    all_ok = True

    for d in dirs:
        dir_path = base_dir / d
        dir_path.mkdir(exist_ok=True)
        if dir_path.exists():
            print(ok(f"Directory: {d}/"))
        else:
            print(fail(f"Could not create directory: {d}/"))
            all_ok = False

    return all_ok


def main():
    print(f"\n{Colors.BOLD}{'='*60}")
    print(f"   AI Video Clipper — Pre-Flight Environment Check")
    print(f"{'='*60}{Colors.RESET}")

    all_passed = True
    warnings = []

    # 1. Python
    print(header("Python"))
    if not check_python_version():
        all_passed = False

    # 2. FFmpeg
    print(header("FFmpeg"))
    if not check_ffmpeg():
        all_passed = False

    # 3. Python Packages
    print(header("Python Packages"))
    installed, missing = check_pip_packages()
    if missing:
        all_passed = False

    # 4. API Keys
    print(header("API Keys"))
    if not check_api_keys():
        all_passed = False

    # 5. Environment
    print(header("Configuration"))
    check_env_file()
    check_directories()

    # ── Summary ──
    print(f"\n{Colors.BOLD}{'='*60}")
    if all_passed:
        print(f"  {Colors.GREEN}ALL CHECKS PASSED{Colors.RESET}")
    else:
        print(f"  {Colors.RED}SOME CHECKS FAILED{Colors.RESET}")

    if missing:
        print(f"\n  {Colors.YELLOW}Install missing packages:{Colors.RESET}")
        print(f"    pip install {' '.join(missing)}")
        print(f"  Or install everything:")
        print(f"    pip install -r requirements.txt")

    if warnings:
        print(f"\n  {Colors.YELLOW}Warnings:{Colors.RESET}")
        for w in warnings:
            print(f"    ⚠ {w}")

    print(f"{'='*60}\n")

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
