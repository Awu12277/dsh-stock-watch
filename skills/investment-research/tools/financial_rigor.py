#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
financial_rigor.py — 金融数据严谨性验证工具（替代版）
用于投资研究报告的关键数据程序化验算，杜绝 LLM 心算误差。
用法示例见文件底部 __main__ 部分。
"""
from decimal import Decimal, ROUND_HALF_UP
import json
import sys


def D(x):
    """安全转 Decimal，失败返回 None"""
    try:
        return Decimal(str(x))
    except Exception:
        return None


def fmt(x, digits=4):
    """格式化 Decimal"""
    if x is None:
        return "N/A"
    return f"{x:.{digits}f}"


def check_deviation(v1, v2, threshold_pct=1.0):
    """计算两个值偏差百分比，|diff|/max(|a|,|b|)"""
    if v1 is None or v2 is None:
        return None
    if v1 == 0 and v2 == 0:
        return Decimal("0")
    diff = abs(v1 - v2)
    base = max(abs(v1), abs(v2))
    return (diff / base) * Decimal("100")


def verify_market_cap(price, shares, reported_cap, currency="CNY"):
    """市值验算：市值 = 价格 × 总股本，与报告市值对比"""
    price_d = D(price)
    shares_d = D(shares)
    reported_d = D(reported_cap)
    if None in (price_d, shares_d, reported_d):
        print(f"[❌] 输入参数无效 (currency={currency})")
        return False
    calc = price_d * shares_d
    dev = check_deviation(calc, reported_d)
    E8 = Decimal("1e8")
    print(f"━━━ 市值验算（{currency}）━━━")
    print(f"  股价        : {fmt(price_d)}")
    print(f"  总股本      : {fmt(shares_d, 0)} 股")
    print(f"  验算市值    : {fmt(calc / E8, 2)} 亿")
    print(f"  报告市值    : {fmt(reported_d / E8, 2)} 亿")
    if dev is None:
        print("  [⚠️] 无法计算偏差")
        return False
    ok = dev <= Decimal("1.0")
    mark = "✅ 通过" if ok else "❌ 偏差过大"
    print(f"  偏差        : {fmt(dev, 3)}%  → {mark}（阈值 1%）")
    return ok


def cross_validate(field, values_dict, unit="元"):
    """多源交叉验证：比较多个来源的同一数据点"""
    print(f"━━━ 交叉验证：{field}（{unit}）━━━")
    items = [(k, D(v)) for k, v in values_dict.items()]
    items = [(k, v) for k, v in items if v is not None]
    if len(items) < 2:
        print("  [⚠️] 有效来源不足 2 个，无法交叉验证")
        return False
    all_ok = True
    ref_name, ref_val = items[0]
    for name, val in items[1:]:
        dev = check_deviation(ref_val, val)
        if dev is None:
            print(f"  {name} vs {ref_name}: 无法计算")
            all_ok = False
            continue
        ok = dev <= Decimal("1.0")
        all_ok = all_ok and ok
        print(f"  {name} = {fmt(val, 2)} vs {ref_name} = {fmt(ref_val, 2)} → 偏差 {fmt(dev, 3)}% {'✅' if ok else '❌'}")
    print(f"  结论: {'✅ 全部通过' if all_ok else '❌ 存在超限偏差'}")
    return all_ok


def verify_valuation(price, eps=None, bvps=None, fcf_ps=None, dividend=None):
    """估值指标精确验算：PE / PB / FCF Yield / 股息率"""
    price_d = D(price)
    print(f"━━━ 估值指标验算（股价 {fmt(price_d)}）━━━")
    ok = True
    if eps is not None:
        eps_d = D(eps)
        if eps_d:
            pe = price_d / eps_d
            print(f"  PE        = 股价 {fmt(price_d)} / EPS {fmt(eps_d, 3)} = {fmt(pe, 2)}")
    if bvps is not None:
        bvps_d = D(bvps)
        if bvps_d:
            pb = price_d / bvps_d
            print(f"  PB        = 股价 {fmt(price_d)} / 每股净资产 {fmt(bvps_d, 3)} = {fmt(pb, 3)}")
    if fcf_ps is not None:
        fcf_d = D(fcf_ps)
        if fcf_d:
            yield_pct = (fcf_d / price_d) * 100
            print(f"  FCF Yield = 每股FCF {fmt(fcf_d, 3)} / 股价 {fmt(price_d)} = {fmt(yield_pct, 2)}%")
    if dividend is not None:
        div_d = D(dividend)
        if div_d:
            dy = (div_d / price_d) * 100
            print(f"  股息率    = 每股股息 {fmt(div_d, 3)} / 股价 {fmt(price_d)} = {fmt(dy, 2)}%")
    return ok


def three_scenario(price, eps, shares_yi, growths, pes, years=3, currency="CNY"):
    """三情景估值：基于 EPS 增长 × 目标 PE 推算目标价与市值"""
    price_d = D(price)
    eps_d = D(eps)
    shares_d = D(shares_yi)  # 单位：亿股
    print(f"━━━ 三情景估值（{currency}，基准 EPS={fmt(eps_d)}，{years}年）━━━")
    base_profit_yi = eps_d * shares_d
    results = {}
    for label, g, pe in zip(["乐观", "中性", "悲观"], growths, pes):
        g_d = D(g) / 100
        pe_d = D(pe)
        # 复利增长
        future_eps = eps_d * (1 + g_d) ** years
        target_price = future_eps * pe_d
        target_cap = target_price * shares_d
        upside = (target_price - price_d) / price_d * 100
        results[label] = (future_eps, target_price, target_cap, upside)
        print(f"  [{label}] 增速{g}%/年 × {years}年 → 未来EPS={fmt(future_eps, 3)}")
        print(f"         目标PE={pe} → 目标价={fmt(target_price, 2)}，目标市值={fmt(target_cap, 1)}亿，较现价 {fmt(upside, 1)}%")
    return results


def verify_roe(net_profit_yi, equity_start_yi, equity_end_yi):
    """ROE 验算（加权平均口径近似）"""
    np_d, es_d, ee_d = D(net_profit_yi), D(equity_start_yi), D(equity_end_yi)
    if None in (np_d, es_d, ee_d):
        print("  [⚠️] ROE 输入无效")
        return None
    avg = (es_d + ee_d) / 2
    roe = np_d / avg * 100
    E8 = Decimal("1e8")
    print(f"━━━ ROE 验算 ━━━")
    print(f"  归母净利 {fmt(np_d / E8, 2)}亿 / 平均归母净资产 {fmt(avg/E8, 2)}亿 = {fmt(roe, 2)}%")
    return roe


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print("用法:")
        print("  python financial_rigor.py verify-market-cap --price P --shares S --reported R --currency C")
        print("  python financial_rigor.py cross-validate --field F --values '{\"src1\": v1, \"src2\": v2}' --unit U")
        print("  python financial_rigor.py verify-valuation --price P --eps E --bvps B --fcf-per-share F --dividend D")
        print("  python financial_rigor.py three-scenario --price P --eps E --shares S亿 --growth g1 g2 g3 --pe pe1 pe2 pe3 --years Y --currency C")
        print("  python financial_rigor.py verify-roe --net-profit 亿 --equity-start 亿 --equity-end 亿")
        sys.exit(0)

    cmd = args[0]

    def get(flag):
        if flag in args:
            i = args.index(flag)
            if i + 1 < len(args):
                return args[i + 1]
        return None

    if cmd == "verify-market-cap":
        verify_market_cap(get("--price"), get("--shares"), get("--reported"), get("--currency") or "CNY")
    elif cmd == "cross-validate":
        values = json.loads(get("--values") or "{}")
        cross_validate(get("--field") or "数据", values, get("--unit") or "元")
    elif cmd == "verify-valuation":
        verify_valuation(get("--price"), get("--eps"), get("--bvps"), get("--fcf-per-share"), get("--dividend"))
    elif cmd == "three-scenario":
        growths = [D(x) for x in args[args.index("--growth") + 1: args.index("--growth") + 4]]
        pes = [D(x) for x in args[args.index("--pe") + 1: args.index("--pe") + 4]]
        three_scenario(get("--price"), get("--eps"), get("--shares"), growths, pes,
                       int(get("--years") or 3), get("--currency") or "CNY")
    elif cmd == "verify-roe":
        verify_roe(get("--net-profit"), get("--equity-start"), get("--equity-end"))
    else:
        print(f"未知命令: {cmd}")
