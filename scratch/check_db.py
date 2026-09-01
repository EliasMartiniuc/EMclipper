import asyncio
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env")
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

res = supabase.table('clips').select('*').limit(1).execute()
print(res.data)
