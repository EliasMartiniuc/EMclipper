import os
import time
import stripe
import requests
import logging
from datetime import datetime
from config import (
    STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, 
    STRIPE_PRO_PRICE_ID, STRIPE_ULTRA_PRICE_ID,
    FREE_UPLOAD_LIMIT, PRO_UPLOAD_LIMIT, ULTRA_UPLOAD_LIMIT,
    ADMIN_EMAIL, SUPABASE_URL, SUPABASE_KEY
)

logger = logging.getLogger('subscriptions')

stripe.api_key = STRIPE_SECRET_KEY

def get_supabase_headers():
    return {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    }

def check_upload_limit(user_id: str, email: str = '') -> dict:
    if email.lower() == ADMIN_EMAIL.lower() and email != '':
        return {'can_upload': True, 'tier': 'admin', 'remaining': 9999, 'limit': 9999}

    url = f'{SUPABASE_URL}/rest/v1/user_subscriptions?user_id=eq.{user_id}'
    resp = requests.get(url, headers=get_supabase_headers())
    
    if resp.status_code != 200:
        logger.error(f'Supabase error: {resp.text}')
        return {'can_upload': False, 'tier': 'error', 'remaining': 0}
    
    data = resp.json()
    
    if not data:
        insert_url = f'{SUPABASE_URL}/rest/v1/user_subscriptions'
        new_sub = {
            'user_id': user_id,
            'tier': 'free',
            'uploads_used': 0
        }
        resp = requests.post(insert_url, headers=get_supabase_headers(), json=new_sub)
        tier = 'free'
        uploads_used = 0
    else:
        sub = data[0]
        tier = sub.get('tier', 'free')
        uploads_used = sub.get('uploads_used', 0)
        
    limit = FREE_UPLOAD_LIMIT
    if tier == 'pro':
        limit = PRO_UPLOAD_LIMIT
    elif tier == 'ultra':
        limit = ULTRA_UPLOAD_LIMIT
        
    remaining = max(0, limit - uploads_used)
    
    return {
        'can_upload': remaining > 0,
        'tier': tier,
        'remaining': remaining,
        'limit': limit
    }

def increment_upload_count(user_id: str):
    url = f'{SUPABASE_URL}/rest/v1/user_subscriptions?user_id=eq.{user_id}'
    resp = requests.get(url, headers=get_supabase_headers())
    if resp.status_code == 200 and resp.json():
        sub = resp.json()[0]
        used = sub.get('uploads_used', 0)
        
        patch_url = f'{SUPABASE_URL}/rest/v1/user_subscriptions?user_id=eq.{user_id}'
        requests.patch(patch_url, headers=get_supabase_headers(), json={'uploads_used': used + 1})

def handle_stripe_webhook(payload: bytes, sig_header: str) -> dict:
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, STRIPE_WEBHOOK_SECRET
        )
    except Exception as e:
        logger.error(f'Webhook error: {e}')
        return {'error': str(e)}

    if event['type'] == 'checkout.session.completed':
        session = event['data']['object']
        customer_id = session.get('customer')
        subscription_id = session.get('subscription')
        user_id = session.get('client_reference_id')
        
        if not user_id: return {'status': 'ignored'}
            
        sub = stripe.Subscription.retrieve(subscription_id)
        price_id = sub['plan']['id']
        
        tier = 'free'
        if price_id == STRIPE_PRO_PRICE_ID: tier = 'pro'
        elif price_id == STRIPE_ULTRA_PRICE_ID: tier = 'ultra'
            
        patch_url = f'{SUPABASE_URL}/rest/v1/user_subscriptions?user_id=eq.{user_id}'
        get_url = f'{SUPABASE_URL}/rest/v1/user_subscriptions?user_id=eq.{user_id}'
        existing = requests.get(get_url, headers=get_supabase_headers()).json()
        
        payload = {
            'tier': tier,
            'stripe_customer_id': customer_id,
            'stripe_subscription_id': subscription_id,
            'uploads_used': 0,
            'period_start': datetime.fromtimestamp(sub['current_period_start']).isoformat(),
            'period_end': datetime.fromtimestamp(sub['current_period_end']).isoformat(),
        }
        
        if existing:
            requests.patch(patch_url, headers=get_supabase_headers(), json=payload)
        else:
            payload['user_id'] = user_id
            requests.post(f'{SUPABASE_URL}/rest/v1/user_subscriptions', headers=get_supabase_headers(), json=payload)
            
    elif event['type'] == 'invoice.payment_succeeded':
        invoice = event['data']['object']
        subscription_id = invoice.get('subscription')
        
        if subscription_id:
            url = f'{SUPABASE_URL}/rest/v1/user_subscriptions?stripe_subscription_id=eq.{subscription_id}'
            existing = requests.get(url, headers=get_supabase_headers()).json()
            if existing:
                sub = stripe.Subscription.retrieve(subscription_id)
                requests.patch(url, headers=get_supabase_headers(), json={
                    'uploads_used': 0,
                    'period_start': datetime.fromtimestamp(sub['current_period_start']).isoformat(),
                    'period_end': datetime.fromtimestamp(sub['current_period_end']).isoformat(),
                })
                
    elif event['type'] == 'customer.subscription.deleted':
        subscription_id = event['data']['object']['id']
        url = f'{SUPABASE_URL}/rest/v1/user_subscriptions?stripe_subscription_id=eq.{subscription_id}'
        requests.patch(url, headers=get_supabase_headers(), json={
            'tier': 'free',
            'stripe_subscription_id': None
        })

    return {'status': 'success'}

def create_checkout_session(user_id: str, email: str, tier: str, success_url: str, cancel_url: str) -> str:
    price_id = STRIPE_PRO_PRICE_ID if tier == 'pro' else STRIPE_ULTRA_PRICE_ID
    
    session = stripe.checkout.Session.create(
        payment_method_types=['card'],
        line_items=[{
            'price': price_id,
            'quantity': 1,
        }],
        mode='subscription',
        success_url=success_url,
        cancel_url=cancel_url,
        customer_email=email,
        client_reference_id=user_id,
    )
    return session.url
