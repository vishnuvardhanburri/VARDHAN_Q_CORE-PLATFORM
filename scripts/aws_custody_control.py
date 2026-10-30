#!/usr/bin/env python3
"""
AWS KMS Hardware Custody Terminal Controller for Vardhan Q-Core.
Allows instant status inspection, hardware drill execution, and security lifecycle management.
"""

import sys
import boto3

KEY_ID = "86a104c0-0561-4746-883e-960950cf61f9"
REGION = "eu-north-1"

def print_help():
    print("""
Vardhan Q-Core: AWS Hardware Custody Controller
Usage:
  ./qcore aws status     - Query live AWS KMS HSM key state, ARN, origin & specs
  ./qcore aws test       - Run live cryptographic hardware envelope drill
  ./qcore aws suspend    - Temporarily suspend/disable KMS key (lockdown)
  ./qcore aws resume     - Reactivate/enable KMS key
""")

def get_client():
    return boto3.client("kms", region_name=REGION)

def status():
    kms = get_client()
    try:
        res = kms.describe_key(KeyId=KEY_ID)
        meta = res["KeyMetadata"]
        print("=" * 60)
        print("  AWS HARDWARE KEY CUSTODY STATUS")
        print("=" * 60)
        print(f"  Key ID:       {meta['KeyId']}")
        print(f"  ARN:          {meta['Arn']}")
        print(f"  Region:       {REGION} (Europe Stockholm)")
        print(f"  Status:       {meta['KeyState'].upper()}")
        print(f"  Origin:       {meta['Origin']} (FIPS 140-2 Level 3 HSM)")
        print(f"  Key Spec:     {meta['CustomerMasterKeySpec']}")
        print(f"  Description:  {meta.get('Description', 'N/A')}")
        print("=" * 60)
    except Exception as e:
        print(f"[ERROR] Failed to query AWS KMS: {e}")
        sys.exit(1)

def suspend():
    kms = get_client()
    try:
        print(f"[*] Suspending AWS KMS Key {KEY_ID}...")
        kms.disable_key(KeyId=KEY_ID)
        print("[✓] Key is now SUSPENDED / DISABLED in AWS. No cryptographic operations can proceed.")
    except Exception as e:
        print(f"[!] Suspend error: {e}")
        print("[TIP] Ensure 'kms:DisableKey' is included in your IAM policy if you want terminal suspend control.")

def resume():
    kms = get_client()
    try:
        print(f"[*] Resuming/Enabling AWS KMS Key {KEY_ID}...")
        kms.enable_key(KeyId=KEY_ID)
        print("[✓] Key is now ENABLED & ACTIVE in AWS.")
    except Exception as e:
        print(f"[!] Resume error: {e}")
        print("[TIP] Ensure 'kms:EnableKey' is included in your IAM policy if you want terminal resume control.")

def main():
    if len(sys.argv) < 2:
        print_help()
        sys.exit(0)

    cmd = sys.argv[1].lower()
    if cmd == "status":
        status()
    elif cmd == "suspend":
        suspend()
    elif cmd == "resume":
        resume()
    elif cmd == "test":
        import os
        os.system("python3 scripts/aws_kms_qcore_live_verification.py")
    else:
        print_help()

if __name__ == "__main__":
    main()
