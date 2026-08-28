import requests
import json
import sys

def test_cobalt(url):
    print(f"Testing Cobalt with URL: {url}")
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        # Sometimes requires a User-Agent or Origin
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Origin": "https://cobalt.tools",
        "Referer": "https://cobalt.tools/"
    }
    payload = {
        "url": url,
        "vCodec": "h264",
        "vQuality": "720",
        "aFormat": "mp3",
        "isAudioOnly": False,
    }
    
    try:
        res = requests.post("https://api.cobalt.tools/api/json", json=payload, headers=headers)
        print(f"Status: {res.status_code}")
        print(res.text)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        test_cobalt(sys.argv[1])
    else:
        test_cobalt("https://www.youtube.com/shorts/322V9m35Vxc")
