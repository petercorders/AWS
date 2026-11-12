"""Fetch a pinned public question corpus; validate everything before replacing data."""
import datetime
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPO = 'CarbonRaven/AWS-Quiz-SAA-C03'


def fetch(url):
    return subprocess.check_output(['curl', '-fsSL', '--retry', '2', '--max-time', '90', url])


def main():
    commit = json.loads(fetch(f'https://api.github.com/repos/{REPO}/commits/main'))['sha']
    archive = zipfile.ZipFile(io.BytesIO(fetch(f'https://codeload.github.com/{REPO}/zip/{commit}')))
    questions = []
    excluded = []
    for name in archive.namelist():
        if not re.search(r'/questions/question_\d+\.json$', name):
            continue
        raw = json.loads(archive.read(name))
        answer = list(raw['correct_answer'].strip())
        options = raw['options']
        assert isinstance(raw['question_number'], int) and raw['question_number'] > 0, name
        assert raw['question_text'].strip() and 2 <= len(options) <= 8, name
        assert answer and len(set(answer)) == len(answer) and all(a in options for a in answer), name
        if not all(re.fullmatch('[A-H]', k) and isinstance(v, str) and v.strip() for k, v in options.items()):
            excluded.append({'id': raw['question_number'], 'reason': 'Empty or invalid option text in source'})
            continue
        votes = raw.get('community_vote') or {}
        # Only retain interpretable answer combinations and percentages.
        votes = {k: v for k, v in votes.items() if re.fullmatch('[A-H]+', k)
                 and all(c in options for c in k) and re.fullmatch(r'\d{1,3}%', str(v))
                 and 0 <= int(v[:-1]) <= 100}
        questions.append({'id': raw['question_number'], 'text': raw['question_text'].strip(),
                          'options': options, 'answer': sorted(answer), 'votes': votes})
    questions.sort(key=lambda q: q['id'])
    assert len(questions) + len(excluded) >= 1000 and len(questions) >= 900, f'Unexpected corpus size: {len(questions)}'
    assert len({q['id'] for q in questions}) == len(questions), 'Duplicate question IDs'
    license_name = next(n for n in archive.namelist() if n.endswith('/LICENSE') and n.count('/') == 1)
    license_text = archive.read(license_name).decode()
    assert 'MIT License' in license_text
    metadata = {'repository': f'https://github.com/{REPO}', 'commit': commit,
                'importedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'count': len(questions), 'language': 'en', 'license': 'MIT (upstream repository)',
                'explanations': False, 'excluded': excluded}
    (ROOT / 'data').mkdir(exist_ok=True)
    (ROOT / 'data/questions.json').write_text(json.dumps(questions, ensure_ascii=False, separators=(',', ':')) + '\n')
    (ROOT / 'data/source.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (ROOT / 'data/UPSTREAM-LICENSE.txt').write_text(license_text)
    print(f'Validated and imported {len(questions)} questions at {commit[:12]}')


if __name__ == '__main__':
    main()
