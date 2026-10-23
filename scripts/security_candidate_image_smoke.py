#!/usr/bin/env python3
"""Check limited startup boundaries of a local candidate; no readiness claim.

Build docker/Dockerfile.prod first. Uses Docker's configured context/DOCKER_HOST.
No ports, credentials, external network, or persistent volumes are supplied.
"""
import argparse
import subprocess
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', default='qcore-security-candidate:local')
    args = parser.parse_args()
    user = subprocess.check_output(
        ['docker', 'image', 'inspect', '--format', '{{.Config.User}}', args.image],
        text=True,
    ).strip()
    if user != '10001:10001':
        raise RuntimeError('Unexpected container user')

    def run(extra):
        name = 'qcore-boundary-' + uuid.uuid4().hex
        try:
            return subprocess.run(
                ['docker', 'run', '--rm', '--name', name, '--network', 'none',
                 '--read-only', '--cap-drop', 'ALL', '--security-opt',
                 'no-new-privileges'] + extra,
                capture_output=True, timeout=30,
            )
        finally:
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=10)

    result = run(['--entrypoint', '/usr/local/bin/pq_verify', args.image, '--help'])
    if result.returncode != 0:
        raise RuntimeError('Audit verifier CLI failed')
    print('Non-root image and audit verifier CLI: passed')
    result = run(['--entrypoint', '/usr/local/bin/vardhan-receipt', args.image, '--help'])
    if result.returncode != 137 or b'VARDHAN_BINARY_HASH' not in result.stdout + result.stderr:
        raise RuntimeError('Missing approved binary hash was not rejected as expected')
    print('Receipt binary rejects missing approved binary hash: passed')
    result = run([
        '--tmpfs', '/var/lib/vardhan:rw,nosuid,nodev,noexec,uid=10001,gid=10001,mode=750',
        '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m', args.image,
    ])
    if result.returncode != 1 or b'VARDHAN_ADMIN_USERNAME not set' not in result.stdout + result.stderr:
        raise RuntimeError('Missing bootstrap identity was not rejected as expected')
    print('Control plane rejects missing bootstrap identity: passed')


if __name__ == '__main__':
    main()
