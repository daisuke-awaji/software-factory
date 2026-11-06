#!/usr/bin/env python3
"""Software Factory の AWS 構成図を draw.io 形式で生成し、重なりを機械的に検査する。

方針:
  - アイコンはグリッドの交点に置く。線は原則として同じ行・同じ列の間だけに引く（折れ線を減らす）
  - 線の経路はすべて明示する（draw.io の自動配線に任せない）
  - 生成したあと、線 × アイコン / 線 × ラベル / 線 × 線 / 線 × グループの枠 / 線のラベル × 物 を検査する
"""
import json, sys
from xml.sax.saxutils import escape

# ---------------- グリッド ----------------
X = {0: 100, 1: 320, 2: 540, 3: 700, 4: 860, 5: 1020, 6: 1230, 7: 1390, 8: 1590, 9: 1760, 10: 1920, 11: 2080, 12: 2280, 13: 2500}
Y = {'T': 175, 0: 300, 1: 450, 2: 600, 3: 750, 4: 900}
ICON = 56
H = ICON // 2

COL = {  # AWS アーキテクチャアイコン（2023 年以降の配色）
    'compute': '#ED7100', 'net': '#8C4FFF', 'db': '#C925D1', 'storage': '#7AA116',
    'sec': '#DD344C', 'mgmt': '#E7157B', 'ml': '#01A88D', 'gen': '#232F3D',
}

nodes, groups, edges = {}, [], []

def node(nid, col, row, label, shape, color, kind='service', lpos='bottom', lw=130):
    cx, cy = X[col], Y[row]
    nodes[nid] = dict(id=nid, cx=cx, cy=cy, label=label, shape=shape, color=color, kind=kind, lpos=lpos, lw=lw)

def group(gid, x1, y1, x2, y2, label, style):
    groups.append(dict(id=gid, x1=x1, y1=y1, x2=x2, y2=y2, label=label, style=style))

def edge(eid, src, dst, pts, label=None, lx=None, ly=None, both=False, dashed=False, lw=None):
    """pts: 始点・中間点・終点の絶対座標（すべて軸に平行な線分になること）"""
    edges.append(dict(id=eid, src=src, dst=dst, pts=pts, label=label, lx=lx, ly=ly, both=both, dashed=dashed, lw=lw))

# ---------------- 外部 ----------------
node('idp', 0, 4, '企業 IdP<br>（SAML / OIDC）', 'traditional_server', COL['gen'], kind='resource')
node('inet', 13, 2, 'インターネット<br>GitHub.com / npm / PyPI', 'internet_alt2', COL['gen'], kind='resource', lw=170)

# ---------------- CloudFront（グローバル） ----------------
node('cf_prev', 1, 'T', 'CloudFront<br>Preview', 'cloudfront', COL['net'])
node('cf_app', 1, 0, 'CloudFront<br>App（SPA + /api）', 'cloudfront', COL['net'])
node('cf_pub', 1, 2, 'CloudFront<br>Publish', 'cloudfront', COL['net'], lpos='top')
node('l_edge', 1, 3, 'Lambda@Edge<br>（公開物の認可）', 'lambda', COL['compute'])

# ---------------- コントロールプレーン ----------------
node('apigw', 2, 0, 'API Gateway<br>HTTP + WebSocket', 'api_gateway', COL['net'])
node('l_api', 3, 0, 'API（Hono）', 'lambda', COL['compute'], lpos='top')
node('df_eng', 4, 0, 'ライン実行エンジン<br>（durable functions）', 'lambda', COL['compute'], lpos='top', lw=140)
node('l_vmm', 5, 0, 'VM マネージャー', 'lambda', COL['compute'])
node('sm', 2, 1, 'Secrets Manager<br>（GitHub トークン）', 'secrets_manager', COL['sec'])
node('ddb', 3, 1, 'DynamoDB', 'dynamodb', COL['db'])
node('df_img', 5, 1, 'イメージビルダー<br>（durable functions）', 'lambda', COL['compute'], lw=140)
node('s3_pub', 2, 2, 'S3（公開物）', 's3', COL['storage'])
node('s3_ws', 3, 2, 'S3（ワークスペース<br>・成果物）', 's3', COL['storage'])
node('sch', 5, 2, 'EventBridge Scheduler<br>（keepalive / checkpoint）', 'eventbridge', COL['mgmt'], lw=150)
node('cw', 2, 3, 'CloudWatch<br>（ログ・メトリクス）', 'cloudwatch_2', COL['mgmt'])
node('aud', 3, 3, '監査ログ（CloudTrail<br>→ S3 Object Lock）', 'cloudtrail', COL['mgmt'])
node('cb', 4, 3, 'Agent Callback API<br>（プライベート）', 'api_gateway', COL['net'])
node('cog', 2, 4, 'Cognito<br>（SSO）', 'cognito', COL['sec'])

# ---------------- Lambda MicroVMs ----------------
node('vm_impl', 6, 0, 'implement<br>web@5', 'lambda_function', COL['compute'], kind='resource')
node('vm_ver', 7, 0, 'verify<br>qa-playwright@2', 'lambda_function', COL['compute'], kind='resource')
node('vm_build', 7, 1, 'ビルド用 VM<br>（カスタムイメージ）', 'lambda_function', COL['compute'], kind='resource')
node('vm_rev', 6, 2, 'review<br>base@7', 'lambda_function', COL['compute'], kind='resource')

# ---------------- VPC ----------------
node('vpce_mvm', 8, 0, 'VPC エンドポイント<br>（MicroVM 接続）', 'endpoints', COL['net'], kind='resource')
node('lnc_bld', 8, 1, 'LNC: build<br>（ENI）', 'elastic_network_interface', COL['net'], kind='resource')
node('lnc_rt', 8, 2, 'LNC: runtime<br>（ENI）', 'elastic_network_interface', COL['net'], kind='resource', lpos='top')
node('vpce', 8, 3, 'VPC エンドポイント<br>（bedrock-runtime<br>/ execute-api）', 'endpoints', COL['net'], kind='resource')
node('alb', 9, 'T', '内部 ALB', 'application_load_balancer', COL['net'], kind='resource', lpos='right', lw=70)
node('f_prev', 9, 0, 'プレビュープロキシ<br>（Fargate）', 'fargate', COL['compute'])
node('nlb', 9, 2, '内部 NLB', 'network_load_balancer', COL['net'], kind='resource')
node('prox', 10, 2, 'egress プロキシ<br>Git ゲートウェイ<br>（Fargate）', 'fargate', COL['compute'])
node('nat', 11, 2, 'NAT Gateway', 'nat_gateway', COL['net'], kind='resource')
node('br', 12, 3, 'Amazon Bedrock<br>（Claude / JP 推論）', 'bedrock', COL['ml'])

# ---------------- グループ ----------------
def gstyle_aws(gr, stroke, font, fill='none', dashed=0):
    return (f"points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];"
            f"outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;container=0;pointerEvents=0;collapsible=0;recursiveResize=0;"
            f"shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.{gr};strokeColor={stroke};fillColor={fill};verticalAlign=top;align=left;spacingLeft=30;fontColor={font};dashed={dashed};")
def gstyle_plain(stroke, dashed=1, fill='none'):
    return (f"rounded=1;arcSize=3;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};dashed={dashed};verticalAlign=top;align=left;"
            f"spacingLeft=10;spacingTop=2;fontColor=#232F3E;fontSize=12;fontStyle=1;container=0;")

group('g_users', 30, 120, 170, 645, '社内ユーザー<br>（ブラウザ）', 'rounded=1;arcSize=6;whiteSpace=wrap;html=1;fillColor=#F4F6F8;strokeColor=#545B64;verticalAlign=top;align=center;spacingTop=6;fontColor=#232F3E;fontSize=12;fontStyle=1;')
group('g_aws', 200, 55, 2390, 995, 'AWS Cloud', gstyle_aws('group_aws_cloud_alt', '#232F3E', '#232F3E'))
group('g_cf', 240, 100, 400, 830, 'CloudFront', gstyle_plain('#8C4FFF'))
group('g_region', 440, 75, 2370, 980, '東京リージョン（ap-northeast-1）', gstyle_aws('group_region', '#00A4A6', '#147EBA', dashed=1))
group('g_cp', 460, 220, 1105, 968, 'コントロールプレーン（サーバーレス）', gstyle_plain('#545B64'))
group('g_mvm', 1150, 228, 1470, 680, 'Lambda MicroVMs<br>（ステージごとに 1 台）', gstyle_plain('#ED7100', dashed=0))
group('g_vpc', 1500, 95, 2170, 960, 'VPC', gstyle_aws('group_vpc2', '#8C4FFF', '#8C4FFF'))
group('g_sub_mvm', 1515, 372, 1667, 680, 'mvm subnet', gstyle_aws('group_security_group', '#00A4A6', '#147EBA', fill='#E6F6F7').replace('group_security_group', 'group_private_subnet'))
group('g_sub_proxy', 1690, 120, 2000, 680, 'private subnet: proxy', gstyle_aws('group_private_subnet', '#00A4A6', '#147EBA', fill='#E6F6F7'))
group('g_sub_pub', 2010, 528, 2152, 680, 'public', gstyle_aws('group_public_subnet', '#7AA116', '#248814', fill='#F2F6E8'))

# ユーザーのアイコン（枠の中、線の通らない位置）
node('users', 0, 1, '', 'users', COL['gen'], kind='resource', lw=10)

# ---------------- 線（すべて明示した経路） ----------------
def R(n): return (nodes[n]['cx'] + H, nodes[n]['cy'])
def L(n): return (nodes[n]['cx'] - H, nodes[n]['cy'])
def T(n): return (nodes[n]['cx'], nodes[n]['cy'] - H)
def B(n): return (nodes[n]['cx'], nodes[n]['cy'] + H)
def GR(g, y): gg = next(x for x in groups if x['id'] == g); return (gg['x2'], y)

edge('e_u_prev', 'g_users', 'cf_prev', [(170, Y['T']), L('cf_prev')])
edge('e_u_app', 'g_users', 'cf_app', [(170, Y[0]), L('cf_app')])
edge('e_u_pub', 'g_users', 'cf_pub', [(170, Y[2]), L('cf_pub')])
edge('e_app_api', 'cf_app', 'apigw', [R('cf_app'), L('apigw')], label='①', lx=417, ly=Y[0])
edge('e_api_l', 'apigw', 'l_api', [R('apigw'), L('l_api')])
edge('e_l_eng', 'l_api', 'df_eng', [R('l_api'), L('df_eng')])
edge('e_eng_vmm', 'df_eng', 'l_vmm', [R('df_eng'), L('l_vmm')])
edge('e_vmm_vm', 'l_vmm', 'vm_impl', [R('l_vmm'), L('vm_impl')], label='②', lx=1127, ly=Y[0])
edge('e_l_ddb', 'l_api', 'ddb', [B('l_api'), T('ddb')])
edge('e_cb_eng', 'cb', 'df_eng', [T('cb'), B('df_eng')], label='③ callback', lx=X[4] + 46, ly=Y[1] + 75, lw=78)
edge('e_pub_s3', 'cf_pub', 's3_pub', [R('cf_pub'), L('s3_pub')], label='⑧', lx=417, ly=Y[2])
edge('e_pub_edge', 'cf_pub', 'l_edge', [B('cf_pub'), T('l_edge')])
edge('e_img_vm', 'df_img', 'vm_build', [R('df_img'), L('vm_build')], label='⑨', lx=1127, ly=Y[1])
edge('e_idp_cog', 'idp', 'cog', [R('idp'), L('cog')], label='⑩ SAML / OIDC', lx=320, ly=Y[4], both=True, lw=104)
edge('e_prev', 'cf_prev', 'alb', [R('cf_prev'), L('alb')], label='⑦ プレビュー（cookie で宛先の VM を決める）', lx=1000, ly=Y['T'], lw=300)
edge('e_alb_fp', 'alb', 'f_prev', [B('alb'), T('f_prev')])
edge('e_fp_vpce', 'f_prev', 'vpce_mvm', [L('f_prev'), R('vpce_mvm')])
edge('e_vpce_vm', 'vpce_mvm', 'g_mvm', [L('vpce_mvm'), GR('g_mvm', Y[0])])
edge('e_vm_lnc', 'g_mvm', 'lnc_rt', [GR('g_mvm', Y[2]), L('lnc_rt')])
edge('e_vb_lnc', 'vm_build', 'lnc_bld', [R('vm_build'), L('lnc_bld')])
edge('e_lnc_nlb', 'lnc_rt', 'nlb', [R('lnc_rt'), L('nlb')])  # ⑤⑥ の番号は NAT → インターネットの線に付ける（ここは枠に挟まれて置けない）
edge('e_bld_nlb', 'lnc_bld', 'nlb', [R('lnc_bld'), (X[9], Y[1]), T('nlb')], label='⑨ :3129', lx=X[9] + 40, ly=(Y[1] + Y[2]) // 2 - 10, lw=62)
edge('e_nlb_prox', 'nlb', 'prox', [R('nlb'), L('prox')])
edge('e_prox_nat', 'prox', 'nat', [R('prox'), L('nat')])
edge('e_nat_inet', 'nat', 'inet', [R('nat'), L('inet')], label='⑤ npm / PyPI　⑥ GitHub.com', lx=2268, ly=Y[2] - 22, lw=190)
edge('e_lnc_vpce', 'lnc_rt', 'vpce', [B('lnc_rt'), T('vpce')])
edge('e_vpce_cb', 'vpce', 'cb', [L('vpce'), R('cb')], label='③ Callback API（イベント・完了・heartbeat）', lx=1300, ly=Y[3], lw=290)
edge('e_vpce_br', 'vpce', 'br', [R('vpce'), L('br')], label='④ InvokeModel', lx=1890, ly=Y[3], lw=110)

# ---------------- 検査 ----------------
def label_box(n):
    lines = n['label'].count('<br>') + 1 if n['label'] else 0
    h = lines * 14 + 4
    w = n['lw']
    cx, cy = n['cx'], n['cy']
    if not n['label']:
        return None
    if n['lpos'] == 'bottom':
        return (cx - w / 2, cy + H + 2, cx + w / 2, cy + H + 2 + h)
    if n['lpos'] == 'top':
        return (cx - w / 2, cy - H - 2 - h, cx + w / 2, cy - H - 2)
    if n['lpos'] == 'right':
        return (cx + H + 4, cy - h / 2, cx + H + 4 + w, cy + h / 2)

def icon_box(n, pad=0):
    return (n['cx'] - H - pad, n['cy'] - H - pad, n['cx'] + H + pad, n['cy'] + H + pad)

def seg_hits_box(p, q, b, shrink=0):
    x1, y1, x2, y2 = b[0] + shrink, b[1] + shrink, b[2] - shrink, b[3] - shrink
    if x1 >= x2 or y1 >= y2: return False
    (ax, ay), (bx, by) = p, q
    if ay == by:  # 水平
        lo, hi = sorted((ax, bx))
        return y1 < ay < y2 and lo < x2 and hi > x1
    if ax == bx:  # 垂直
        lo, hi = sorted((ay, by))
        return x1 < ax < x2 and lo < y2 and hi > y1
    raise ValueError('斜めの線分がある')

def segs(e):
    return list(zip(e['pts'][:-1], e['pts'][1:]))

def seg_cross(s, t):
    (a, b), (c, d) = s, t
    sh, th = a[1] == b[1], c[1] == d[1]
    if sh and th:  # 平行（水平）: 同じ y で範囲が重なると「重なり」
        if a[1] != c[1]: return None
        lo1, hi1 = sorted((a[0], b[0])); lo2, hi2 = sorted((c[0], d[0]))
        return 'overlap' if min(hi1, hi2) - max(lo1, lo2) > 0 else None
    if not sh and not th:
        if a[0] != c[0]: return None
        lo1, hi1 = sorted((a[1], b[1])); lo2, hi2 = sorted((c[1], d[1]))
        return 'overlap' if min(hi1, hi2) - max(lo1, lo2) > 0 else None
    h, v = (s, t) if sh else (t, s)
    hy = h[0][1]; hlo, hhi = sorted((h[0][0], h[1][0]))
    vx = v[0][0]; vlo, vhi = sorted((v[0][1], v[1][1]))
    if hlo < vx < hhi and vlo < hy < vhi:
        return 'cross'
    return None

def edge_label_box(e):
    if not e['label']: return None
    w = e['lw'] or 24
    return (e['lx'] - w / 2, e['ly'] - 9, e['lx'] + w / 2, e['ly'] + 9)

def check():
    problems = []
    for e in edges:
        for p, q in segs(e):
            if not (p[0] == q[0] or p[1] == q[1]):
                problems.append(f"{e['id']}: 斜めの線分")
                continue
            for n in nodes.values():
                own = n['id'] in (e['src'], e['dst'])
                if seg_hits_box(p, q, icon_box(n), shrink=3 if own else -2):
                    problems.append(f"{e['id']} がアイコン {n['id']} に重なる")
                lb = label_box(n)
                if lb and seg_hits_box(p, q, lb, shrink=-1):
                    problems.append(f"{e['id']} がラベル {n['id']} に重なる")
            for g in groups:  # 枠の上を線が走っていないか
                for side in [((g['x1'], g['y1']), (g['x2'], g['y1'])), ((g['x1'], g['y2']), (g['x2'], g['y2'])),
                             ((g['x1'], g['y1']), (g['x1'], g['y2'])), ((g['x2'], g['y1']), (g['x2'], g['y2']))]:
                    if seg_cross((p, q), side) == 'overlap':
                        problems.append(f"{e['id']} が枠 {g['id']} の線の上を走る")
                # グループのラベル（左上）に重ならないか
                gl = (g['x1'], g['y1'], g['x1'] + 260, g['y1'] + 34) if g['id'] != 'g_users' else (g['x1'], g['y1'], g['x2'], g['y1'] + 40)
                if seg_hits_box(p, q, gl, shrink=0) and g['id'] not in ('g_aws',):
                    problems.append(f"{e['id']} がグループ {g['id']} のラベルに重なる")
        bends = len(e['pts']) - 2
        if bends > 1:
            problems.append(f"{e['id']}: 折れ曲がりが {bends} 回")
    for i, e in enumerate(edges):
        for f in edges[i + 1:]:
            for s in segs(e):
                for t in segs(f):
                    r = seg_cross(s, t)
                    if r == 'overlap' and not (e['dst'] == f['dst'] and s[1] == t[1]):
                        problems.append(f"{e['id']} と {f['id']} が重なる")
                    elif r == 'cross':
                        problems.append(f"{e['id']} と {f['id']} が交差する")
    # 線のラベル × アイコン・ラベル・他の線
    for e in edges:
        lb = edge_label_box(e)
        if not lb: continue
        for n in nodes.values():
            for b in [icon_box(n, 6), label_box(n)]:
                if b and not (lb[2] <= b[0] or lb[0] >= b[2] or lb[3] <= b[1] or lb[1] >= b[3]):
                    problems.append(f"線のラベル {e['id']} が {n['id']} に近すぎる・重なる")
        for f in edges:
            if f is e: continue
            for p, q in segs(f):
                if seg_hits_box(p, q, lb):
                    problems.append(f"線のラベル {e['id']} が線 {f['id']} に重なる")
    # グループのラベル × アイコン・ノードのラベル
    for g in groups:
        if g['id'] in ('g_aws',):
            continue
        lines = g['label'].count('<br>') + 1
        longest = max(len(t) for t in g['label'].split('<br>'))
        w = min(g['x2'] - g['x1'], 34 + longest * 12)
        gl = (g['x1'], g['y1'], g['x1'] + w, g['y1'] + 6 + lines * 17) if g['id'] != 'g_users' else (g['x1'], g['y1'], g['x2'], g['y1'] + 44)
        for n in nodes.values():
            for b in [icon_box(n, 2), label_box(n)]:
                if b and not (gl[2] <= b[0] or gl[0] >= b[2] or gl[3] <= b[1] or gl[1] >= b[3]):
                    problems.append(f"グループ {g['id']} のラベルが {n['id']} に重なる")
        if 34 + longest * 12 > g['x2'] - g['x1'] + 8:
            problems.append(f"グループ {g['id']} のラベルが枠の幅に収まらない（折り返す）")
    # 線のラベル × グループの枠線
    for e in edges:
        lb = edge_label_box(e)
        if not lb: continue
        for g in groups:
            for xline in (g['x1'], g['x2']):
                if lb[0] < xline < lb[2] and g['y1'] < (lb[1] + lb[3]) / 2 < g['y2']:
                    problems.append(f"線のラベル {e['id']} が枠 {g['id']} の縦線にかかる")
            for yline in (g['y1'], g['y2']):
                if lb[1] < yline < lb[3] and g['x1'] < (lb[0] + lb[2]) / 2 < g['x2']:
                    problems.append(f"線のラベル {e['id']} が枠 {g['id']} の横線にかかる")
    # アイコン・ラベル同士
    nl = list(nodes.values())
    for i, a in enumerate(nl):
        for b in nl[i + 1:]:
            for ba in [icon_box(a, 4), label_box(a)]:
                for bb in [icon_box(b, 4), label_box(b)]:
                    if ba and bb and not (ba[2] <= bb[0] or ba[0] >= bb[2] or ba[3] <= bb[1] or ba[1] >= bb[3]):
                        problems.append(f"{a['id']} と {b['id']} が重なる")
    return problems

# ---------------- draw.io の XML ----------------
def node_style(n):
    lp = {'bottom': 'verticalLabelPosition=bottom;verticalAlign=top;align=center;',
          'top': 'verticalLabelPosition=top;verticalAlign=bottom;align=center;',
          'right': 'labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;spacingLeft=4;'}[n['lpos']]
    common = f"sketch=0;outlineConnect=0;fontColor=#232F3E;dashed=0;html=1;fontSize=11;fontStyle=0;aspect=fixed;{lp}"
    if n['kind'] == 'service':
        return common + f"fillColor={n['color']};strokeColor=#ffffff;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.{n['shape']};"
    return common + f"gradientColor=none;fillColor={n['color']};strokeColor=none;pointerEvents=1;shape=mxgraph.aws4.{n['shape']};"

def to_xml():
    cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']
    cells.append('<mxCell id="title" value="Software Factory — AWS 構成図（MVP）" style="text;html=1;fontSize=20;fontStyle=1;fontColor=#232F3E;align=left;verticalAlign=middle;" vertex="1" parent="1"><mxGeometry x="30" y="8" width="700" height="36" as="geometry"/></mxCell>')
    for g in groups:
        cells.append(f'<mxCell id="{g["id"]}" value="{escape(g["label"])}" style="{g["style"]}" vertex="1" parent="1"><mxGeometry x="{g["x1"]}" y="{g["y1"]}" width="{g["x2"]-g["x1"]}" height="{g["y2"]-g["y1"]}" as="geometry"/></mxCell>')
    for e in edges:
        st = ("edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;strokeColor=#545B64;strokeWidth=1.5;"
              "fontSize=11;fontColor=#232F3E;labelBackgroundColor=#FFFFFF;jumpStyle=none;")
        if e['both']: st += 'startArrow=block;startFill=1;'
        if e['dashed']: st += 'dashed=1;'
        pts = e['pts']
        wps = ''.join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in pts[1:-1])
        geo = (f'<mxGeometry relative="1" as="geometry"><mxPoint x="{pts[0][0]}" y="{pts[0][1]}" as="sourcePoint"/>'
               f'<mxPoint x="{pts[-1][0]}" y="{pts[-1][1]}" as="targetPoint"/>' + (f'<Array as="points">{wps}</Array>' if wps else '') + '</mxGeometry>')
        cells.append(f'<mxCell id="{e["id"]}" style="{st}" edge="1" parent="1">{geo}</mxCell>')
        if e['label']:
            w = e['lw'] or 24
            cells.append(f'<mxCell id="{e["id"]}_lbl" value="{escape(e["label"])}" style="text;html=1;align=center;verticalAlign=middle;fontSize=11;fontColor=#232F3E;labelBackgroundColor=#FFFFFF;fillColor=#FFFFFF;strokeColor=none;spacing=0;" vertex="1" parent="1">'
                         f'<mxGeometry x="{e["lx"]-w/2}" y="{e["ly"]-9}" width="{w}" height="18" as="geometry"/></mxCell>')
    for n in nodes.values():
        cells.append(f'<mxCell id="{n["id"]}" value="{escape(n["label"])}" style="{node_style(n)}" vertex="1" parent="1"><mxGeometry x="{n["cx"]-H}" y="{n["cy"]-H}" width="{ICON}" height="{ICON}" as="geometry"/></mxCell>')
    # 凡例
    legend = [('①', 'UI / API: ユーザー → CloudFront(App) → API Gateway（Cognito の JWT）→ Hono'),
              ('②', 'コントロールプレーン → VM: VM マネージャーが RunMicrovm / HTTPS + JWE トークンで指示'),
              ('③', 'VM → Callback API（execute-api の VPC エンドポイント）→ ライン実行エンジンに callback'),
              ('④', 'VM → Bedrock（bedrock-runtime の VPC エンドポイント、JP 推論プロファイル）'),
              ('⑤', 'VM → egress プロキシ（allowlist）→ NAT → npm / PyPI'),
              ('⑥', 'VM → Git ゲートウェイ（GitHub トークンを付与・保護ブランチへの push を拒否）→ GitHub.com'),
              ('⑦', 'プレビュー: CloudFront(Preview) → 内部 ALB → プレビュープロキシ → VM'),
              ('⑧', '社内公開: CloudFront(Publish) + Lambda@Edge（JWT と ACL）→ S3'),
              ('⑨', 'イメージのビルド: イメージビルダー → ビルド用 VM → LNC: build → egress プロキシ（:3129）'),
              ('⑩', 'SSO: 企業 IdP ⇄ Cognito')]
    # 凡例: HTML の table はビューアの描画範囲に入らないので、1行ずつのテキストにする（2列）
    cells.append(f'<mxCell id="legend_title" value="通信経路（番号は docs/03_architecture.md §1.1 に対応）" style="text;html=1;fontSize=13;fontStyle=1;fontColor=#232F3E;align=left;verticalAlign=middle;" vertex="1" parent="1"><mxGeometry x="200" y="1010" width="700" height="24" as="geometry"/></mxCell>')
    for i, (k, v) in enumerate(legend):
        col, row = divmod(i, 5)
        x = 200 + col * 1100
        y = 1040 + row * 24
        cells.append(f'<mxCell id="legend_{i}" value="{escape(k + "　" + v)}" style="text;html=1;fontSize=12;fontColor=#232F3E;align=left;verticalAlign=middle;whiteSpace=nowrap;" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="1080" height="22" as="geometry"/></mxCell>')
    body = ''.join(cells)
    return (f'<mxfile host="software-factory" version="24.0.0"><diagram id="aws" name="AWS 構成図">'
            f'<mxGraphModel dx="2600" dy="1300" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="2640" pageHeight="1320" math="0" shadow="0">'
            f'<root>{body}</root></mxGraphModel></diagram></mxfile>')

if __name__ == '__main__':
    probs = check()
    bends = {e['id']: len(e['pts']) - 2 for e in edges}
    print(f"nodes={len(nodes)} edges={len(edges)} groups={len(groups)} 折れ曲がりのある線={[k for k, v in bends.items() if v]}")
    if probs:
        print('問題:'); [print('  -', p) for p in sorted(set(probs))]
    else:
        print('検査: 問題なし')
    open(sys.argv[1], 'w', encoding='utf-8').write(to_xml())
