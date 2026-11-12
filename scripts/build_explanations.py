"""Assemble manually authored research batches, bound to the current question corpus."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    corpus = (ROOT / 'data/questions.json').read_bytes()
    corpus_hash = hashlib.sha256(corpus).hexdigest()
    recorded_hash = (ROOT / 'data/explanation-parts/corpus.sha256').read_text().strip()
    assert corpus_hash == recorded_hash, 'Questions changed since content authoring: review explanations before updating the corpus snapshot'
    questions = json.loads(corpus)
    by_id = {q['id']: q for q in questions}
    entries = []
    reference_overrides = json.loads((ROOT / 'scripts/reference_overrides.json').read_text())
    parts = sorted((ROOT / 'data/explanation-parts').glob('part-*.json'))
    assert len(parts) == 3, 'All three content research parts are required'
    for part in parts:
        batch = json.loads(part.read_text())
        assert isinstance(batch, list), part
        entries.extend(batch)
    assert len(entries) == len(questions), f'Expected {len(questions)} explanations, received {len(entries)}'
    assert len({e['id'] for e in entries}) == len(entries), 'Duplicate explanation IDs'
    assert set(by_id) == {e['id'] for e in entries}, 'Question/explanation IDs differ'
    for entry in entries:
        q = by_id[entry['id']]
        assert set(entry['options']) == set(q['options']), f'Options differ for question {q["id"]}'
        assert len(entry['summary']) >= 15, q['id']
        assert all(len(reason) >= 8 for reason in entry['options'].values()), q['id']
        assert entry['references'], q['id']
        for reference in entry['references']:
            reference['url'] = reference_overrides.get(reference['url'], reference['url'])
    result = {'version': 1, 'language': 'ko', 'corpusSha256': corpus_hash,
              'authorship': 'Original Korean study explanations based on the linked AWS documentation; not official AWS exam solutions.',
              'entries': sorted(entries, key=lambda e: e['id'])}
    (ROOT / 'data/explanations.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    review = [e['id'] for e in entries if e.get('reviewNote')]
    print(f'Compiled {len(entries)} explanations; {len(review)} questions marked for source review')


if __name__ == '__main__':
    main()
