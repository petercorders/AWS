"""Exercise Korean explanations in a dedicated local Orca preview, preserving saved progress."""
import argparse
import json
import os
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--page', required=True)
args = parser.parse_args()
CLI = os.environ.get('ORCA_CLI_COMMAND', 'orca')


def call(*arguments):
    response = json.loads(subprocess.check_output([CLI, *arguments, '--json'], text=True))
    assert response.get('ok'), response
    return response['result']


def evaluate(expression):
    result = call('eval', '--page', args.page, '--expression', expression)['result']
    return json.loads(result) if isinstance(result, str) else result


def expect(label, expression):
    assert evaluate(expression) is True, label
    print('PASS', label, flush=True)


def wait_for(selector):
    call('wait', '--page', args.page, '--selector', selector)


expect('local QA origin', "location.origin==='http://127.0.0.1:4317'")
original = evaluate("JSON.stringify({raw:localStorage.getItem('aws-saa-study:v1')})")['raw']
try:
    evaluate("localStorage.removeItem('aws-saa-study:v1');window.dispatchEvent(new StorageEvent('storage',{key:'aws-saa-study:v1'}));true")
    expect('open first question and grade', "(() => {document.querySelector('[data-action=begin]').click();document.querySelector('input[value=A]').click();document.querySelector('[data-action=submit]').click();return !!document.querySelector('.answer-panel');})()")
    wait_for('.explanation-summary')
    expect('Korean rationale and the remaining option reasons', "(() => {const summary=document.querySelector('.explanation-summary').textContent;document.querySelector('.other-reasons').open=true;return /[가-힣]/.test(summary)&&document.querySelectorAll('.choice-reason').length===4&&document.querySelectorAll('.explanation-references a').length>0;})()")
    expect('failed explanation request preserves saved progress', """(async()=>{
      const before=localStorage.getItem('aws-saa-study:v1');
      window.__explanationFetch=window.fetch;
      window.fetch=(...args)=>String(args[0]).includes('explanations.json')?Promise.reject(new Error('QA offline')):window.__explanationFetch(...args);
      const button=document.createElement('button');button.dataset.action='retry-explanations';document.querySelector('main').append(button);button.click();button.remove();
      await new Promise(resolve=>setTimeout(resolve,50));
      const failed=!!document.querySelector('.explanation-unavailable button:not([disabled])');
      window.fetch=window.__explanationFetch;delete window.__explanationFetch;
      return failed&&before===localStorage.getItem('aws-saa-study:v1');
    })()""")
    evaluate("document.querySelector('[data-action=retry-explanations]').click();true")
    wait_for('.explanation-summary')
    expect('retry restores explanation without rewriting progress', "JSON.parse(localStorage.getItem('aws-saa-study:v1')).history[1].attempts===1")
    call('reload', '--page', args.page)
    wait_for('[data-action=resume]')
    evaluate("document.querySelector('[data-action=resume]').click();true")
    wait_for('.explanation-summary')
    expect('existing submitted answer shows explanation after reload', "!!document.querySelector('.answer-panel')&&document.querySelector('input[value=A]').checked")
    expect('reviewed source key is separate from author rationale', """(async()=>{
      const bank=await(await fetch('data/questions.json')).json();
      const i=bank.findIndex(q=>q.id===21);document.querySelector('[data-index="'+i+'"]').click();
      document.querySelector('input[value=D]').click();document.querySelector('[data-action=submit]').click();
      return document.querySelector('.answer-review').textContent.includes('D')&&document.querySelector('.answer-review').textContent.includes('출처 정답 재검토')&&JSON.parse(localStorage.getItem('aws-saa-study:v1')).history[21].selected[0]==='D';
    })()""")
    call('viewport', '--page', args.page, '--width', '390', '--height', '844', '--mobile')
    expect('mobile explanation has no horizontal overflow', 'document.documentElement.scrollWidth<=innerWidth')
    evaluate("document.querySelector('.explanation').scrollIntoView();true")
    print('Screenshot:', call('screenshot', '--page', args.page).get('path'), flush=True)
    call('viewport', '--page', args.page, '--width', '1440', '--height', '1000')
    expect('desktop explanation has no horizontal overflow', 'document.documentElement.scrollWidth<=innerWidth')
    # Model an insecure HTTP browser without Web Crypto. This must affect only
    # explanations, never question loading or progress restoration.
    root = Path(__file__).resolve().parents[1]
    fixture = root / 'artifacts/explanation-no-crypto.html'
    html = (root / 'index.html').read_text()
    assert '<head>' in html
    fixture.write_text(html.replace('<head>', '<head><base href="/"><script>Object.defineProperty(window,"crypto",{value:{}});</script>', 1))
    before = evaluate("JSON.stringify({raw:localStorage.getItem('aws-saa-study:v1')})")['raw']
    call('goto', '--page', args.page, '--url', 'http://127.0.0.1:4317/artifacts/explanation-no-crypto.html')
    wait_for('[data-action=resume]')
    expect('missing Web Crypto preserves question loading and saved progress', "!!document.querySelector('[data-action=resume]')&&!document.body.innerText.includes('문제를 불러오지 못했어요.')")
    after = evaluate("JSON.stringify({raw:localStorage.getItem('aws-saa-study:v1')})")['raw']
    assert before == after
    call('goto', '--page', args.page, '--url', 'http://127.0.0.1:4317/')
    wait_for('[data-action=resume]')
finally:
    raw = json.dumps(original)
    evaluate(f"(() => {{if(window.__explanationFetch) window.fetch=window.__explanationFetch;const raw={raw};if(raw===null)localStorage.removeItem('aws-saa-study:v1');else localStorage.setItem('aws-saa-study:v1',raw);window.dispatchEvent(new StorageEvent('storage',{{key:'aws-saa-study:v1'}}));return true;}})()")
