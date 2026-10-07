import { useEffect, useRef } from 'react';

export function RulesScreen({ onBack }: { onBack: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  return <article className="panel results rules-page" aria-labelledby="rules-title">
    <header className="rules-page-header">
      <h2 id="rules-title" ref={heading} tabIndex={-1}>ルール説明</h2>
      <button type="button" onClick={onBack}>戻る</button>
    </header>
    <p className="rules-intro">サイコロを振り、1と5で得点しながら、ゲームモードごとの条件で順位を決めます。</p>

    <div className="rules-sections">
      <section className="rules-section" aria-labelledby="rules-basic">
        <h3 id="rules-basic">基本ルール</h3>
        <ul>
          <li>1は100点、5は50点です。一度のROLLで出た1と5は、すべて得点になります。</li>
          <li>1または5が出たサイコロは取り除かれます。得点があり、振れるサイコロが残っていて、ROLL上限にも達していなければ続けて振ります。</li>
          <li>1と5が1つも出なければ、そのTurnは終了です。最初のROLLで得点がなくても同じです。</li>
          <li>取り除かれていないサイコロがなくなり、残りが0個になると完走（COMPLETE）です。</li>
        </ul>
        <p>OUTになったサイコロはそのRound中は振り直せず、得点にもなりません。残りダイスには数えますが、残っている間は完走できません。</p>
      </section>

      <section className="rules-section" aria-labelledby="rules-settings">
        <h3 id="rules-settings">ゲーム設定</h3>
        <ul>
          <li>Dice Modeは5 / 7 / 10 / 14 DICEから選びます。</li>
          <li>投げ方は「乱暴」「普通」「丁寧」です。乱暴はOUTしやすく、普通は標準、丁寧ではOUTしません。</li>
          <li>ROLL上限は∞ / 1 / 2 / 3 / 4 / 5です。有限の上限は1 Turnで振れる最大回数です。Penaltyには適用されません。</li>
          <li>完走指定ではROLL上限を使わず、∞固定です。</li>
        </ul>
      </section>

      <section className="rules-section" aria-labelledby="rules-normal">
        <h3 id="rules-normal">ノーマル</h3>
        <p>全員が1Turnずつ行うRoundを繰り返します。順位は完走者が非完走者より上位で、完走者同士は同順位です。非完走者は得点が高い方、同点なら残りダイスが少ない方が上位です。条件が完全に同じなら同順位になります。</p>
        <p>同順位の次の順位は人数分空きます。最下位の順位が複数人なら、全員がPenaltyの対象です。</p>
        <p>全員が完走した場合、または全員が未完走で得点と残りダイスが完全に同じ場合はSudden Deathです。全員が元の順番で次のRoundを行い、得点とダイス状態はリセットされます。累積完走回数は維持されます。</p>
      </section>

      <section className="rules-section" aria-labelledby="rules-target">
        <h3 id="rules-target">完走指定</h3>
        <p>「最低完走者数」を1〜5で設定します。完走回数はRoundをまたいで累積し、同じ人が別のRoundで再び完走しても1回として加算されます。</p>
        <p>目標に達した瞬間には終了しません。そのRoundの全員がTurnを終えてから判定します。目標未達なら全員で次のRoundへ進みます。Round途中で目標を超えることもあります。</p>
        <p>目標到達後も、全員完走または全員未完走で得点・残りダイスが完全一致なら、Sudden Deathで次のRoundへ進みます。最終的な順位は決着したRoundだけで判定します。</p>
        <p>ROLL上限は∞固定です。</p>
      </section>

      <section className="rules-section" aria-labelledby="rules-series">
        <h3 id="rules-series">連続試合</h3>
        <p>2〜5試合を行い、各試合で全員が1Turnずつプレイします。各試合の得点と残りダイスを累積し、完走した試合の残りダイスは0として加算します。各試合の間に途中結果を確認できます。</p>
        <p>試合ごとの勝敗・Penalty・Sudden Deathはありません。最終試合後、累積得点が高い方を上位とし、同点なら累積残りダイスが少ない方を上位とします。完全一致は同順位です。完走状態は順位の優先条件になりません。</p>
        <p>Sudden Deathは行いません。最下位が全員同順位でも、全員がPenaltyの対象です。</p>
      </section>

      <section className="rules-section" aria-labelledby="rules-penalty">
        <h3 id="rules-penalty">Penalty（ペナルティポイント）</h3>
        <p>ノーマルと完走指定では、決着したRoundの最下位全員が、それぞれ残りダイスを1回振ります。1や5の特別得点・取り除きはありません。PenaltyのOUTはOUTのまま表示され、計算するときだけ6として扱います。</p>
        <p>連続試合では、敗者の累積残りダイスを振ります。最大70個になる場合がありますが、一度に振るのは最大10個です。たとえば15個なら10個、次に5個。各敗者の最初のROLLはボタンを押し、2回目以降のchunkは自動で進みます。次の敗者では、もう一度最初のROLLを行います。</p>
        <p>累積残りダイスが0個ならROLLせず、BASE 0・FINAL 0です。各PenaltyのBASEを合計してから、累積完走回数 + 1 の倍率を一度だけ掛けます。たとえば完走回数3回なら倍率は×4です。</p>
      </section>
    </div>
  </article>;
}
