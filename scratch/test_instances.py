import requests
import json
import sys

def test_instances(url):
    try:
        res = requests.get("https://instances.cobalt.tools/instances.json")
        instances = res.json()
        
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
        
        payload = {
            "url": url
        }
        
        valid_instances = []
        for instance in instances:
            api_url = f"https://{instance['domain']}/api/json"
            print(f"Testing {api_url}...")
            try:
                r = requests.post(api_url, json=payload, headers=headers, timeout=5)
                if r.status_code == 200:
                    print(f"SUCCESS: {api_url}")
                    valid_instances.append(api_url)
                    break
            except Exception as e:
                pass
                
        print("\nValid instances found:", valid_instances)
        
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        test_instances(sys.argv[1])
    else:
        test_instances("https://www.youtube.com/shorts/322V9m35Vxc")
