import os
import json
import shutil
from pathlib import Path
from yt_dlp import YoutubeDL

def main():
    print("=========================================================")
    print("  YouTube OAuth2 Token Generator for Render")
    print("=========================================================\n")
    print("This script will guide you through authenticating with YouTube.")
    print("You will see a link and a code below. Please open the link in your browser,")
    print("enter the code, and log in with your YouTube account.\n")
    
    # Define a clean local cache directory
    base_dir = Path(__file__).parent
    cache_dir = base_dir / ".cache" / "yt-dlp_setup"
    
    # Clean previous attempts
    if cache_dir.exists():
        shutil.rmtree(cache_dir)
    
    cache_dir.mkdir(parents=True, exist_ok=True)
    
    ydl_opts = {
        "username": "oauth2",
        "password": "",
        "cache_dir": str(cache_dir),
        "quiet": False,
    }
    
    try:
        # We try to download info for an age-restricted video to trigger the login flow
        print("Starting authentication flow... Please watch for the prompt below:")
        with YoutubeDL(ydl_opts) as ydl:
            ydl.extract_info("https://www.youtube.com/watch?v=QkkoHAzjnUs", download=False)
            
        print("\nAuthentication successful!")
    except Exception as e:
        print(f"\nAuthentication process finished or encountered an error: {e}")
    
    # Now try to find the token
    token_file = cache_dir / "youtube-oauth2" / "token.json"
    if token_file.exists():
        with open(token_file, "r", encoding="utf-8") as f:
            token_data = json.load(f)
            
        print("\n" + "="*60)
        print("SUCCESS! Your OAuth Token has been generated.")
        print("="*60)
        print("\n1. Copy the ENTIRE JSON string below:")
        print("-" * 60)
        print(json.dumps(token_data))
        print("-" * 60)
        print("\n2. Go to your Render Dashboard -> Environment Variables")
        print("3. Add a new variable:")
        print("   Key:   YOUTUBE_OAUTH_TOKEN")
        print("   Value: <Paste the exact JSON string you copied above>")
        print("\n4. You can also paste it in your local .env file to test it locally.")
    else:
        print("\nFailed to generate token. The token.json file was not found.")
        print("Please run the script again and make sure to complete the login in your browser.")

if __name__ == "__main__":
    main()
