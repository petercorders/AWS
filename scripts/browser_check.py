"""Run the study flow against an explicitly selected Orca browser page."""
import argparse
import json
import subprocess
import os
import atexit

ORCA = os.environ.get('ORCA_CLI_COMMAND', 'orca')
parser = argparse.ArgumentParser()
parser.add_argument('--page', required=True)
args = parser.parse_args()
checks = []


def run(*command):
    result = json.loads(subprocess.check_output([ORCA, *command, '--json'], text=True))
    if not result.get('ok'):
        raise RuntimeError(result)
    return result['result']


def evaluate(source):
    value = run('eval', '--page', args.page, '--expression', source)['result']
    return json.loads(value) if isinstance(value, str) else value


def check(label, source):
    result = evaluate(source)
    if result is not True:
        raise AssertionError(f'{label}: {result}')
    checks.append(label)
    print('PASS', label, flush=True)


if evaluate("location.origin === 'http://127.0.0.1:4317'") is not True:
    raise RuntimeError('Browser QA only runs on the dedicated local preview origin.')
original = evaluate("JSON.stringify({raw:localStorage.getItem('aws-saa-study:v1')})")['raw']


def restore_records():
    raw = json.dumps(original)
    evaluate(f"(() => {{ const raw={raw}; if(raw===null) localStorage.removeItem('aws-saa-study:v1'); else localStorage.setItem('aws-saa-study:v1',raw); window.dispatchEvent(new StorageEvent('storage',{{key:'aws-saa-study:v1'}})); return true; }})()")


atexit.register(restore_records)
evaluate("localStorage.setItem('aws-saa-study:v1',JSON.stringify({version:1,history:{},bookmarks:[],session:null})); window.dispatchEvent(new StorageEvent('storage',{key:'aws-saa-study:v1'})); true")
check('initial corpus and desktop layout', '''document.querySelectorAll('.question-row').length === 15 && document.body.innerText.includes('999문제') && document.documentElement.scrollWidth <= innerWidth''')
check('choose answer and persist draft', '''(() => {
 document.querySelector('[data-action="begin"]').click();
 document.querySelector('input[value="B"]').click();
 const s=JSON.parse(localStorage.getItem('aws-saa-study:v1'));
 return s.session.drafts[1][0]==='B' && !document.querySelector('#submit-answer').disabled;
})()''')
run('reload', '--page', args.page)
run('wait', '--page', args.page, '--selector', '[data-action="resume"]')
check('reload restores unfinished selection', '''(() => {
 document.querySelector('[data-action="resume"]').click();
 return document.querySelector('input[value="B"]').checked && !document.querySelector('#submit-answer').disabled;
})()''')
check('wrong grading, bookmark and navigation persisted', '''(() => {
 document.querySelector('[data-action="submit"]').click();
 const wrong=document.querySelector('.answer-panel.wrong')!==null;
 document.querySelector('[data-star="1"]').click();
 document.querySelector('[data-action="next"]').click();
 document.querySelector('input[value="A"]').click();
 const s=JSON.parse(localStorage.getItem('aws-saa-study:v1'));
 return wrong && s.history[1].attempts===1 && s.bookmarks.includes(1) && s.session.index===1 && s.session.drafts[2][0]==='A';
})()''')
run('reload', '--page', args.page)
run('wait', '--page', args.page, '--selector', '[data-action="resume"]')
check('reload restores order, current question and history', '''(() => {
 document.querySelector('[data-action="resume"]').click();
 const second=document.querySelector('.question-number').textContent.includes('002') && document.querySelector('input[value="A"]').checked;
 document.querySelector('[data-action="home"]').click();
 document.querySelector('[data-filter="wrong"]').click();
 return second && document.querySelectorAll('.question-row').length===1 && document.querySelector('[data-open="1"]')!==null;
})()''')
check('backup import waits for confirmation; cancel preserves state', '''(async () => {
 const original=localStorage.getItem('aws-saa-study:v1');
 const {emptyState}=await import('./assets/core.js');
 const dt=new DataTransfer(); dt.items.add(new File([JSON.stringify({app:'aws-saa-study',state:emptyState()})],'backup.json',{type:'application/json'}));
 const input=document.querySelector('#import-file'); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true}));
 await new Promise(resolve=>setTimeout(resolve,100));
 const open=document.querySelector('dialog').open;
 document.querySelector('button[value="cancel"]').click();
 return open && localStorage.getItem('aws-saa-study:v1')===original;
})()''')
check('invalid backup is rejected without changing records', '''(async () => {
 const original=localStorage.getItem('aws-saa-study:v1');
 const dt=new DataTransfer(); dt.items.add(new File(['{"app":"aws-saa-study","state":{}}'],'bad.json',{type:'application/json'}));
 const input=document.querySelector('#import-file'); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true}));
 await new Promise(resolve=>setTimeout(resolve,100));
 return !document.querySelector('dialog').open && localStorage.getItem('aws-saa-study:v1')===original && !document.querySelector('#notice').hidden;
})()''')
check('valid backup replaces only after confirmation', '''(async () => {
 const {emptyState}=await import('./assets/core.js');
 const backup=emptyState(); backup.bookmarks=[2];
 const dt=new DataTransfer(); dt.items.add(new File([JSON.stringify({app:'aws-saa-study',state:backup})],'good.json',{type:'application/json'}));
 const input=document.querySelector('#import-file'); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true}));
 await new Promise(resolve=>setTimeout(resolve,100));
 document.querySelector('#dialog-apply').click();
 await new Promise(resolve=>setTimeout(resolve,30));
 const s=JSON.parse(localStorage.getItem('aws-saa-study:v1'));
 return s.bookmarks.length===1 && s.bookmarks[0]===2 && Object.keys(s.history).length===0;
})()''')
check('multiple selection requires exact count, records a correct answer', '''(async () => {
 const bank=await (await fetch('./data/questions.json')).json(); const q=bank.find(q=>q.answer.length>1);
 document.querySelector('[data-action="begin"]').click();
 document.querySelector('[data-index="'+bank.indexOf(q)+'"]').click();
 document.querySelector('input[value="'+q.answer[0]+'"]').click();
 const partial=document.querySelector('#submit-answer').disabled;
 q.answer.slice(1).forEach(key=>document.querySelector('input[value="'+key+'"]').click());
 document.querySelector('[data-action="submit"]').click();
 return partial && !!document.querySelector('.answer-panel:not(.wrong)');
})()''')
check('save failure is visible and retry keeps current records', '''(() => {
 const original=Storage.prototype.setItem;
 Storage.prototype.setItem=function(){throw new Error('quota test')};
 document.querySelector('[data-star]').click();
 const failed=document.querySelector('#save-status').textContent.includes('저장되지');
 Storage.prototype.setItem=original;
 Array.from(document.querySelectorAll('#notice button')).find(b=>b.textContent==='다시 저장').click();
 return failed && document.querySelector('#save-status').textContent==='이 브라우저에 저장됨';
})()''')
run('viewport', '--page', args.page, '--width', '390', '--height', '844', '--mobile')
check('mobile study has no horizontal overflow', 'document.documentElement.scrollWidth<=innerWidth && innerWidth===390')
shot = run('screenshot', '--page', args.page)
print('Mobile screenshot:', shot.get('path'))
check('mobile home has no horizontal overflow', '''(() => { document.querySelector('[data-action="home"]').click(); return document.documentElement.scrollWidth<=innerWidth; })()''')
# Use an intentionally corrupt record only in this local QA origin.
evaluate("localStorage.setItem('aws-saa-study:v1','{broken'); true")
run('reload', '--page', args.page)
run('wait', '--page', args.page, '--selector', '#notice:not([hidden])')
check('corrupt records are preserved without automatic overwrite', "localStorage.getItem('aws-saa-study:v1')==='{broken' && document.querySelector('#save-status').classList.contains('error')")
check('corrupt replacement is confirmed and resumes saving', '''(async () => {
 Array.from(document.querySelectorAll('#notice button')).find(b=>b.textContent==='새 기록 저장 허용').click();
 document.querySelector('#dialog-apply').click();
 await new Promise(resolve=>setTimeout(resolve,30));
 return JSON.parse(localStorage.getItem('aws-saa-study:v1')).version===1 && document.querySelector('#notice').hidden;
})()''')
check('random set contains 20 unique questions', '''(() => {
 document.querySelector('[data-action="random"]').click();
 const s=JSON.parse(localStorage.getItem('aws-saa-study:v1')).session;
 return s.mode==='random' && s.ids.length===20 && new Set(s.ids).size===20;
})()''')
check('skipped questions are not scored in the summary', '''(() => {
 document.querySelector('[data-index="19"]').click();
 document.querySelector('[data-action="next"]').click();
 return !!document.querySelector('.summary') && document.querySelectorAll('.summary .stat-value')[2].textContent.includes('20');
})()''')
check('search by exact question ID and empty result', '''(() => {
 document.querySelector('[data-action="home"]').click();
 const search=document.querySelector('#search'); search.value='#2'; search.dispatchEvent(new Event('input',{bubbles:true}));
 const found=document.querySelectorAll('.question-row').length===1 && !!document.querySelector('[data-open="2"]');
 search.value='xyz-no-such-aws-question-123'; search.dispatchEvent(new Event('input',{bubbles:true}));
 const empty=!!document.querySelector('.empty');
 search.value=''; search.dispatchEvent(new Event('input',{bubbles:true}));
 return found && empty;
})()''')
run('viewport', '--page', args.page, '--width', '1440', '--height', '1000')
print(f'{len(checks)} browser checks passed')
