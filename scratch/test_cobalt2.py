import requests
import json
import sys

def test_cobalt(url):
    print(f"Testing Cobalt with URL: {url}")
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "url": url,
    }
    
    try:
        # API is actually just https://api.cobalt.tools/ now
        res = requests.post("https://api.cobalt.tools/", json=payload, headers=headers)
        print(f"Status: {res.status_code}")
        print(res.text)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        test_cobalt(sys.argv[1])
    else:
        test_cobalt("https://www.youtube.com/shorts/322V9m35Vxc")
