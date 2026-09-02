import urllib.request, json, time

with open(r'I:\Users\ttqf\.mindthegap-harness\app-state.json', encoding='utf-8') as f:
    state = json.load(f)
key = state['providers'][0]['apiKey']

# 测试 1: 非流式
print('Test 1: non-stream request...')
req = urllib.request.Request(
    'https://api.deepseek.com/v1/chat/completions',
    data=json.dumps({'model':'deepseek-v4-flash','messages':[{'role':'user','content':'say hi in 3 words'}],'stream':False}).encode(),
    headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}
)
start = time.time()
resp = urllib.request.urlopen(req, timeout=30)
d = json.loads(resp.read())
print(f'  OK in {time.time()-start:.2f}s: {d["choices"][0]["message"]["content"]}')

# 测试 2: 流式 (SSE)
print('Test 2: stream request...')
req2 = urllib.request.Request(
    'https://api.deepseek.com/v1/chat/completions',
    data=json.dumps({'model':'deepseek-v4-flash','messages':[{'role':'user','content':'say hi in 3 words'}],'stream':True}).encode(),
    headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}
)
start = time.time()
resp2 = urllib.request.urlopen(req2, timeout=30)
print(f'  Response status: {resp2.status}')
buf = b''
count = 0
for line in resp2:
    buf += line
    count += 1
    if count <= 3:
        print(f'  chunk #{count}: {line[:80]}')
elapsed = time.time() - start
print(f'  Stream complete in {elapsed:.2f}s, {count} chunks')
