"""Check that explanation references resolve to AWS documentation, caching successful checks locally."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'artifacts/explanation-link-checks.json'


def valid_result(url, result):
    # AWS redirects missing legacy .html topics to a 200 documentation index.
    # Such responses do not verify a working topic-level reference.
    topic_lost = urlsplit(url).path.endswith('.html') and not urlsplit(result['effective']).path.endswith('.html')
    return result['status'] == '200' and not topic_lost


def check(url):
    result = subprocess.run(['curl', '-sSL', '--max-time', '25', '--connect-timeout', '8',
                             '-o', '/dev/null', '-w', '%{http_code}\t%{url_effective}', url],
                            capture_output=True, text=True)
    fields = result.stdout.split('\t', 1)
    status = fields[0] if fields else '000'
    effective = fields[1] if len(fields) > 1 else url
    value = {'status': status, 'effective': effective}
    value['ok'] = result.returncode == 0 and valid_result(url, value)
    return url, value


def main():
    entries = []
    for path in sorted((ROOT / 'data/explanation-parts').glob('part-*.json')):
        entries.extend(json.loads(path.read_text()))
    overrides = json.loads((ROOT / 'scripts/reference_overrides.json').read_text())
    references = sorted({overrides.get(reference['url'], reference['url']) for entry in entries for reference in entry['references']})
    results = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    needed = [url for url in references if not results.get(url, {}).get('ok') or not valid_result(url, results[url])]
    with ThreadPoolExecutor(max_workers=6) as executor:
        for url, result in executor.map(check, needed):
            results[url] = result
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(results, indent=2) + '\n')
    failed = [url for url in references if not results[url]['ok']]
    redirected = [url for url in references if results[url]['effective'].split('#')[0] != url.split('#')[0]]
    print(f'{len(entries)} explanations, {len(references)} unique links, {len(failed)} HTTP failures, {len(redirected)} redirects')
    for url in failed:
        print('FAIL', results[url]['status'], url)
    for url in redirected:
        print('REDIRECT', url, '->', results[url]['effective'])
    if failed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
