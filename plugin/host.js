// dsh-stock-watch Host half (code.host) - 从运行时归档，与运行中的 pkg-5 完全一致
return {
  inject: ['fs', 'subprocess'],
  apply(ctx) {
    const fs = ctx.fs
    const subprocess = ctx.subprocess
    const shellEnv = ctx.get('shellEnv')
    const shell = ctx.get('shell')

    const DEFAULT_GROUPS = [
      { name: '分组1', symbols: [{ code: 'sh000001' }, { code: 'sz399300' }, { code: 'sh601899' }] },
      { name: '分组2', symbols: [] },
    ]

    let homeCache
    async function resolveHome() {
      if (homeCache !== undefined) return homeCache
      let home
      try {
        if (shellEnv !== undefined) {
          const env = shellEnv.collect({})
          const dshHome = env && env['DSH_HOME']
          if (typeof dshHome === 'string' && dshHome.length > 0) {
            const norm = dshHome.replace(/\\/g, '/')
            if (norm.endsWith('/.dsh')) home = norm.slice(0, -5)
          }
        }
      } catch (e) { /* ignore */ }
      if (!home && shell !== undefined) {
        try {
          const spec = shell.resolve({ command: "node -p \"require('os').homedir()\"", timeoutMs: 5000, stdoutMaxBytes: 4096 })
          const result = await shell.run(spec)
          const text = result && result.stdout ? result.stdout.text : ''
          const line = String(text || '').split(/\r?\n/)[0].trim()
          if (line) home = line.replace(/\\/g, '/')
        } catch (e) { /* ignore */ }
      }
      homeCache = home || null
      return homeCache
    }

    function normalizePrice(v) {
      const n = typeof v === 'string' ? parseFloat(v) : v
      if (typeof n !== 'number' || !isFinite(n) || n <= 0) return undefined
      return n
    }
    function normalizeSymbol(raw) {
      if (typeof raw === 'string') return { code: raw }
      if (!raw || typeof raw !== 'object') return null
      const o = raw
      if (typeof o.code !== 'string' || o.code.length === 0) return null
      const s = { code: o.code }
      if (typeof o.name === 'string' && o.name.trim()) s.name = o.name.trim()
      const buy = normalizePrice(o.buyPrice)
      if (buy !== undefined) s.buyPrice = buy
      const sell = normalizePrice(o.sellPrice)
      if (sell !== undefined) s.sellPrice = sell
      return s
    }
    function normalizeGroup(raw) {
      if (!raw || typeof raw !== 'object') return null
      const name = (typeof raw.name === 'string' && raw.name.trim()) ? raw.name.trim().slice(0, 32) : '未命名分组'
      const symbols = []
      const seen = new Set()
      if (Array.isArray(raw.symbols)) {
        for (const item of raw.symbols) {
          const sym = normalizeSymbol(item)
          if (!sym || seen.has(sym.code)) continue
          seen.add(sym.code)
          symbols.push(sym)
        }
      }
      return { name, symbols }
    }
    function normalizeClientGroups(raw) {
      if (!Array.isArray(raw)) return null
      const out = []
      const seen = new Set()
      for (const item of raw) {
        const g = normalizeGroup(item)
        if (!g) continue
        g.symbols = g.symbols.filter((s) => {
          if (seen.has(s.code)) return false
          seen.add(s.code)
          return true
        })
        out.push(g)
      }
      return out.length > 0 ? out : null
    }
    async function loadGroups() {
      const home = await resolveHome()
      if (!home) return { groups: DEFAULT_GROUPS, source: 'default', path: null }
      const path = home + '/.stocking/settings.json'
      try {
        const target = await fs.resolve(path)
        const text = await fs.readText(target)
        const parsed = JSON.parse(text)
        const groups = []
        const seen = new Set()
        if (Array.isArray(parsed && parsed.groups)) {
          for (const item of parsed.groups) {
            const group = normalizeGroup(item)
            if (!group) continue
            group.symbols = group.symbols.filter((s) => {
              if (seen.has(s.code)) return false
              seen.add(s.code)
              return true
            })
            groups.push(group)
          }
        } else if (Array.isArray(parsed && parsed.symbols)) {
          const group = { name: '分组1', symbols: [] }
          const localSeen = new Set()
          for (const item of parsed.symbols) {
            const sym = normalizeSymbol(item)
            if (!sym || localSeen.has(sym.code)) continue
            localSeen.add(sym.code)
            group.symbols.push(sym)
          }
          groups.push(group)
        }
        if (groups.length > 0) return { groups, source: 'file', path }
      } catch (e) { /* ignore */ }
      return { groups: DEFAULT_GROUPS, source: 'default', path }
    }

    // ---------- 腾讯财经接口（与 market.ts 同源：Node 原生 fetch 直连） ----------
    const MINUTE_API = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={code}&r=0.1'
    const KLINE_API = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},{period},,,{count},qfq'

    const BRIDGE_SCRIPT = `const fs=require('fs');
const payload=JSON.parse(Buffer.from(process.argv[2],'base64').toString());
const jobs=Array.isArray(payload)?payload:((payload&&payload.jobs)||[]);
(async()=>{
  const results=await Promise.all(jobs.map(async(job)=>{
    try{
      const res=await fetch(job.url,{signal:AbortSignal.timeout(12000)});
      const text=await res.text();
      return {id:job.id,ok:true,status:res.status,text};
    }catch(e){
      return {id:job.id,ok:false,error:String((e&&e.message)||e)};
    }
  }));
  process.stdout.write(JSON.stringify({results}));
})().catch((e)=>{
  process.stdout.write(JSON.stringify({fatal:String((e&&e.message)||e)}));
  process.exitCode=1;
});`

    let nodePathCache
    async function nodeExecutable() {
      if (nodePathCache !== undefined) return nodePathCache
      try {
        nodePathCache = await subprocess.resolveExecutable('node')
      } catch (e) {
        nodePathCache = null
      }
      return nodePathCache
    }

    async function bridgeFetch(jobs) {
      const nodePath = await nodeExecutable()
      if (!nodePath) return jobs.map((j) => ({ id: j.id, ok: false, error: '未找到 node 可执行文件' }))
      let cwd = '.'
      try {
        cwd = fs.processPath(await fs.resolve('.'))
      } catch (e) { /* ignore */ }
      const evalCode = "eval(Buffer.from(process.argv[1],'base64').toString())"
      const spec = {
        argv: [nodePath, '-e', evalCode, btoa(BRIDGE_SCRIPT), btoa(JSON.stringify({ jobs }))],
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 4 * 1024 * 1024 },
          stderr: { maxBytes: 64 * 1024 },
        },
        graceMs: 8000,
      }
      try {
        const handle = subprocess.spawn(spec)
        const outcome = await handle.done
        const outText = (handle.collected && handle.collected.stdout) ? handle.collected.stdout.readFrom(0).text : ''
        const errText = (handle.collected && handle.collected.stderr) ? handle.collected.stderr.readFrom(0).text : ''
        if (outcome.exitCode !== 0) {
          const detail = String(errText || '').trim().slice(0, 300)
          return jobs.map((j) => ({ id: j.id, ok: false, error: 'node 退出码 ' + outcome.exitCode + (detail ? '：' + detail : '') }))
        }
        const parsed = JSON.parse(outText)
        if (parsed && Array.isArray(parsed.results)) return parsed.results
        return jobs.map((j) => ({ id: j.id, ok: false, error: parsed && parsed.fatal ? 'node：' + parsed.fatal : 'node 未返回结果' }))
      } catch (e) {
        return jobs.map((j) => ({ id: j.id, ok: false, error: 'node 进程失败：' + String((e && e.message) || e) }))
      }
    }

    function normalizeApiCode(code) {
      if (code.startsWith('sh') || code.startsWith('sz')) return code
      if (/^(60|68|51)/.test(code)) return 'sh' + code
      if (/^(00|30|39)/.test(code)) return 'sz' + code
      return 'sh' + code
    }

    function parseMinuteText(code, text, includeMinutes) {
      try {
        const json = JSON.parse(text)
        if (!json || json.code !== 0) return { quote: null, prices: [] }
        const apiCode = normalizeApiCode(code)
        const sd = json.data && json.data[apiCode]
        if (!sd) return { quote: null, prices: [] }
        let prices = []
        if (includeMinutes) {
          const raw = sd.data && sd.data.data
          if (Array.isArray(raw)) {
            for (const line of raw) {
              const parts = String(line).split(' ')
              if (parts.length >= 2) {
                const p = parseFloat(parts[1])
                if (!isNaN(p)) prices.push(p)
              }
            }
          }
        }
        const qt = sd.qt && sd.qt[apiCode]
        if (Array.isArray(qt) && qt.length >= 35) {
          return {
            quote: {
              code,
              name: String(qt[1] || ''),
              price: parseFloat(qt[3] || '0'),
              changeAmount: parseFloat(qt[31] || '0'),
              changePercent: parseFloat(qt[32] || '0'),
              high: parseFloat(qt[33] || '0'),
              low: parseFloat(qt[34] || '0'),
              volume: parseInt(qt[6] || '0', 10),
              amount: parseFloat(qt[37] || '0') * 10000,
            },
            prices,
          }
        }
        return { quote: null, prices }
      } catch (e) {
        return { quote: null, prices: [] }
      }
    }

    function computeTrigger(price, buyPrice, sellPrice) {
      if (buyPrice === undefined && sellPrice === undefined) return 'none'
      if (sellPrice !== undefined && price >= sellPrice) return 'sell'
      if (buyPrice !== undefined && price <= buyPrice) return 'buy'
      return 'wait'
    }

    async function fetchKline(code, period, refPrice) {
      const apiCode = normalizeApiCode(code)
      const count = period === 'day' ? '160' : '120'
      const url = KLINE_API.replace('{code}', apiCode).replace('{period}', period).replace('{count}', count)
      const results = await bridgeFetch([{ id: 'k', url }])
      const r = results[0]
      if (!r || !r.ok || !r.text) return { candles: [], error: (r && r.error) || '行情获取失败' }
      try {
        const json = JSON.parse(r.text)
        if (!json || json.code !== 0) return { candles: [], error: '接口返回异常' }
        const sd = json.data && json.data[apiCode]
        if (!sd) return { candles: [], error: '无K线数据' }
        const keys = period === 'day'
          ? ['qfqday', 'day', 'hfqday']
          : period === 'week' ? ['qfqweek', 'week', 'hfqweek'] : ['qfqmonth', 'month', 'hfqmonth']
        let rows = null
        for (const k of keys) {
          if (Array.isArray(sd[k])) { rows = sd[k]; break }
        }
        if (!rows) return { candles: [], error: '无K线数据' }
        const candles = []
        for (const row of rows) {
          if (!Array.isArray(row) || row.length < 5) continue
          const time = String(row[0])
          const open = parseFloat(row[1])
          const close = parseFloat(row[2])
          const high = parseFloat(row[3])
          const low = parseFloat(row[4])
          if (!time || isNaN(open) || isNaN(close) || isNaN(high) || isNaN(low)) continue
          candles.push({ time, open, high, low, close, volume: parseFloat(row[5]) || 0 })
        }
        if (candles.length === 0) return { candles: [], error: '无K线数据' }
        if (typeof refPrice === 'number' && isFinite(refPrice) && refPrice > 0) {
          const last = candles[candles.length - 1]
          if (last) {
            const dClose = Math.abs(last.close - refPrice)
            const dLow = Math.abs(last.low - refPrice)
            if (dLow < dClose) {
              for (const c of candles) {
                const close = c.low
                const high = c.close
                const low = c.high
                c.close = close
                c.high = high
                c.low = low
              }
            }
          }
        }
        return { candles, error: null }
      } catch (e) {
        return { candles: [], error: '行情解析失败' }
      }
    }

    async function fetchMinuteDetail(code) {
      const apiCode = normalizeApiCode(code)
      const url = MINUTE_API.replace('{code}', apiCode)
      const results = await bridgeFetch([{ id: 'm', url }])
      const r = results[0]
      if (!r || !r.ok || !r.text) return { date: null, prevClose: null, points: [], error: (r && r.error) || '行情获取失败' }
      try {
        const json = JSON.parse(r.text)
        if (!json || json.code !== 0) return { date: null, prevClose: null, points: [], error: '接口返回异常' }
        const sd = json.data && json.data[apiCode]
        if (!sd || !sd.data) return { date: null, prevClose: null, points: [], error: '无分时数据' }
        const raw = sd.data.data
        const date = typeof sd.data.date === 'string' ? sd.data.date : ''
        const isoDate = date.length === 8 ? date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8) : ''
        const points = []
        if (Array.isArray(raw)) {
          for (const line of raw) {
            const parts = String(line).split(' ')
            if (parts.length < 3) continue
            const hm = parts[0]
            const p = parseFloat(parts[1])
            const v = parseFloat(parts[2]) || 0
            if (!/^\d{4}$/.test(hm) || isNaN(p)) continue
            let t = 0
            if (isoDate) {
              const ms = Date.parse(isoDate + 'T' + hm.slice(0, 2) + ':' + hm.slice(2, 4) + ':00+08:00')
              if (!isNaN(ms)) t = Math.round(ms / 1000)
            }
            if (t <= 0) continue
            points.push({ t, p, v })
          }
        }
        let prevClose = null
        const qt = sd.qt && sd.qt[apiCode]
        if (Array.isArray(qt) && qt.length >= 35) {
          const price = parseFloat(qt[3] || '0')
          const chg = parseFloat(qt[32] || '0')
          if (price > 0 && isFinite(chg)) prevClose = price / (1 + chg / 100)
        }
        if (points.length === 0) return { date, prevClose, points: [], error: '无分时数据' }
        return { date, prevClose, points, error: null }
      } catch (e) {
        return { date: null, prevClose: null, points: [], error: '行情解析失败' }
      }
    }

    // ---------- 包私有 RPC（Client → Host） ----------
    ctx.effect(() => harness.handle('stocking.config', async () => {
      const loaded = await loadGroups()
      return { groups: loaded.groups, source: loaded.source, path: loaded.path }
    }), 'stocking: config RPC')

    ctx.effect(() => harness.handle('stocking.quotes', async (args) => {
      const a = (args && typeof args === 'object') ? args : {}
      const groupIndex = Number.isInteger(a.groupIndex) && a.groupIndex >= 0 ? a.groupIndex : 0
      const includeMinutes = a.includeMinutes === true
      // 客户端 localStorage 配置优先；未传时回退读文件（首次迁移前的兼容路径）
      const clientGroups = normalizeClientGroups(a.groups)
      const loaded = clientGroups ? { groups: clientGroups, source: 'local', path: null } : await loadGroups()
      const groups = loaded.groups
      const safeIdx = groups.length > 0 ? Math.min(groupIndex, groups.length - 1) : 0
      const group = groups[safeIdx] || groups[0] || null
      const symbols = group ? group.symbols : []
      const jobs = symbols.map((s, i) => ({
        id: String(i),
        url: MINUTE_API.replace('{code}', normalizeApiCode(s.code)),
      }))
      const fetched = await bridgeFetch(jobs)
      const byId = {}
      let firstError = null
      for (const r of fetched) byId[r.id] = r
      const rows = []
      let live = 0
      for (let i = 0; i < symbols.length; i++) {
        const sym = symbols[i]
        const r = byId[String(i)]
        const parsed = (!r || !r.ok || !r.text) ? { quote: null, prices: [] } : parseMinuteText(sym.code, r.text, includeMinutes)
        if (!parsed.quote && !firstError) firstError = (r && r.error) || '拉取失败'
        const q = parsed.quote
        const row = {
          code: sym.code,
          name: q ? q.name : (sym.name || sym.code),
          trigger: 'none',
          live: false,
        }
        if (sym.buyPrice !== undefined) row.buyPrice = sym.buyPrice
        if (sym.sellPrice !== undefined) row.sellPrice = sym.sellPrice
        if (q) {
          live += 1
          row.live = true
          row.price = q.price
          row.changePercent = q.changePercent
          row.changeAmount = q.changeAmount
          row.high = q.high
          row.low = q.low
          row.volume = q.volume
          row.amount = q.amount
          row.trigger = computeTrigger(q.price, sym.buyPrice, sym.sellPrice)
          if (includeMinutes && parsed.prices && parsed.prices.length > 0) row.minutes = parsed.prices
        }
        rows.push(row)
      }
      return {
        groups: groups.map((g) => ({ name: g.name, count: g.symbols.length })),
        groupIndex: safeIdx,
        rows,
        live: live > 0,
        updatedAt: Date.now(),
        config: { source: loaded.source, path: loaded.path },
        diag: { node: (await nodeExecutable()) || null, firstError },
      }
    }), 'stocking: quotes RPC')

    ctx.effect(() => harness.handle('stocking.kline', async (args) => {
      const a = (args && typeof args === 'object') ? args : {}
      const code = typeof a.code === 'string' ? a.code : ''
      const period = (a.period === 'week' || a.period === 'month') ? a.period : 'day'
      const refPrice = (typeof a.refPrice === 'number' && isFinite(a.refPrice) && a.refPrice > 0) ? a.refPrice : null
      if (!code) return { code, period, candles: [], error: '缺少股票代码', updatedAt: Date.now() }
      const result = await fetchKline(code, period, refPrice)
      return { code, period, candles: result.candles, error: result.error, updatedAt: Date.now() }
    }), 'stocking: kline RPC')

    ctx.effect(() => harness.handle('stocking.minute', async (args) => {
      const a = (args && typeof args === 'object') ? args : {}
      const code = typeof a.code === 'string' ? a.code : ''
      if (!code) return { code, date: null, prevClose: null, points: [], error: '缺少股票代码', updatedAt: Date.now() }
      const result = await fetchMinuteDetail(code)
      return { code, date: result.date, prevClose: result.prevClose, points: result.points, error: result.error, updatedAt: Date.now() }
    }), 'stocking: minute RPC')
  },
}
