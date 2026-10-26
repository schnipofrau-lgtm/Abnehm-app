// Das Plüschmonster: zeichnet ein SVG und schaltet Stimmungen um.
(function () {
  // kleiner Zufallsgenerator mit festem Startwert, damit das Fell immer gleich aussieht
  function rng(seed) {
    return function () {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
  }

  function furRing(cx, cy, rx, ry, count, minLen, maxLen, seed, cls) {
    const r = rng(seed);
    let d = "";
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + r() * 0.08;
      const w = 0.09 + r() * 0.06;
      const len = minLen + r() * (maxLen - minLen);
      const bend = (r() - 0.5) * 0.35;
      const x1 = cx + Math.cos(a - w) * rx, y1 = cy + Math.sin(a - w) * ry;
      const x2 = cx + Math.cos(a + w) * rx, y2 = cy + Math.sin(a + w) * ry;
      const tx = cx + Math.cos(a + bend) * (rx + len), ty = cy + Math.sin(a + bend) * (ry + len);
      const mx = cx + Math.cos(a) * (rx + len * 0.55), my = cy + Math.sin(a) * (ry + len * 0.55);
      d += `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}Z `;
    }
    return `<path class="${cls}" d="${d}"/>`;
  }

  function furStrokes(cx, cy, rx, ry, count, seed) {
    const r = rng(seed);
    let d = "";
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const dist = Math.sqrt(r()) * 0.85;
      const x = cx + Math.cos(a) * rx * dist, y = cy + Math.sin(a) * ry * dist;
      const ang = a + (r() - 0.5) * 0.8;
      const l = 5 + r() * 6;
      const x2 = x + Math.cos(ang) * l, y2 = y + Math.sin(ang) * l;
      const qx = (x + x2) / 2 + (r() - 0.5) * 4, qy = (y + y2) / 2 + (r() - 0.5) * 4;
      d += `M${x.toFixed(1)} ${y.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)} `;
    }
    return `<path class="m-strand" d="${d}"/>`;
  }

  const MOUTHS = {
    happy: '<path class="m-mouth-open" d="M86 132 Q100 150 114 132 Q100 137 86 132Z"/><path class="m-tongue" d="M94 140 Q100 146 106 140 Q100 138 94 140Z"/>',
    party: '<path class="m-mouth-open" d="M82 128 Q100 158 118 128 Q100 134 82 128Z"/><path class="m-tongue" d="M92 141 Q100 151 108 141 Q100 138 92 141Z"/>',
    sleepy: '<ellipse class="m-mouth-open" cx="100" cy="137" rx="5" ry="6"/>',
    nervous: '<path class="m-line" d="M86 137 q4.5 -5 9 0 t9 0 t9 0"/>',
    sad: '<path class="m-line" d="M88 141 Q100 130 112 141"/>'
  };

  function svg(id) {
    const g = id || "m";
    return `
<svg class="monster-svg" viewBox="0 0 200 210" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="${g}-body" cx="40%" cy="35%" r="75%">
      <stop offset="0" stop-color="#ffc2e6"/>
      <stop offset="0.55" stop-color="#f08bd0"/>
      <stop offset="1" stop-color="#a868e0"/>
    </radialGradient>
    <radialGradient id="${g}-fur" cx="50%" cy="40%" r="70%">
      <stop offset="0" stop-color="#f7a3db"/>
      <stop offset="1" stop-color="#9a5ad6"/>
    </radialGradient>
    <linearGradient id="${g}-horn" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff4c9"/>
      <stop offset="1" stop-color="#e9c7ff"/>
    </linearGradient>
  </defs>
  <ellipse class="m-shadow" cx="100" cy="200" rx="52" ry="7"/>
  <g class="m-bob">
    <g class="m-body">
      <g class="m-feet">
        <ellipse cx="78" cy="184" rx="17" ry="11" fill="url(#${g}-fur)"/>
        <ellipse cx="122" cy="184" rx="17" ry="11" fill="url(#${g}-fur)"/>
        <ellipse class="m-toe" cx="72" cy="188" rx="3" ry="2"/><ellipse class="m-toe" cx="79" cy="190" rx="3" ry="2"/><ellipse class="m-toe" cx="86" cy="188" rx="3" ry="2"/>
        <ellipse class="m-toe" cx="114" cy="188" rx="3" ry="2"/><ellipse class="m-toe" cx="121" cy="190" rx="3" ry="2"/><ellipse class="m-toe" cx="128" cy="188" rx="3" ry="2"/>
      </g>
      <g class="m-horns">
        <path d="M64 58 Q46 32 56 8 Q64 34 84 48Z" fill="url(#${g}-horn)" stroke="#c99ae8" stroke-width="1.5"/>
        <path d="M136 58 Q154 32 144 8 Q136 34 116 48Z" fill="url(#${g}-horn)" stroke="#c99ae8" stroke-width="1.5"/>
      </g>
      <g fill="url(#${g}-fur)">${furRing(100, 112, 60, 64, 46, 9, 20, 7, "m-fur-outer")}</g>
      <ellipse cx="100" cy="112" rx="62" ry="66" fill="url(#${g}-body)"/>
      <g class="m-tuft">${furRing(100, 52, 10, 6, 9, 8, 16, 21, "m-fur-top")}</g>
      ${furStrokes(100, 112, 58, 62, 70, 3)}
      <ellipse class="m-spot" cx="62" cy="150" rx="9" ry="6"/>
      <ellipse class="m-spot" cx="140" cy="88" rx="6" ry="4"/>
      <ellipse class="m-spot" cx="134" cy="158" rx="5" ry="3.5"/>
      <g class="m-arm m-arm-l"><ellipse cx="40" cy="128" rx="11" ry="17" fill="url(#${g}-fur)" transform="rotate(20 40 128)"/></g>
      <g class="m-arm m-arm-r"><ellipse cx="160" cy="128" rx="11" ry="17" fill="url(#${g}-fur)" transform="rotate(-20 160 128)"/></g>
      <ellipse class="m-belly" cx="100" cy="148" rx="30" ry="24"/>
      <g class="m-face">
        <g class="m-eyes">
          <g class="m-eye m-eye-l">
            <ellipse class="m-eye-white" cx="78" cy="104" rx="17" ry="19"/>
            <ellipse class="m-pupil" cx="80" cy="107" rx="11" ry="13"/>
            <circle class="m-shine" cx="85" cy="100" r="4.5"/><circle class="m-shine" cx="76" cy="113" r="2"/>
          </g>
          <g class="m-eye m-eye-r">
            <ellipse class="m-eye-white" cx="122" cy="104" rx="17" ry="19"/>
            <ellipse class="m-pupil" cx="120" cy="107" rx="11" ry="13"/>
            <circle class="m-shine" cx="125" cy="100" r="4.5"/><circle class="m-shine" cx="116" cy="113" r="2"/>
          </g>
        </g>
        <g class="m-closed">
          <path class="m-line" d="M64 108 Q78 118 92 108"/>
          <path class="m-line" d="M108 108 Q122 118 136 108"/>
        </g>
        <g class="m-sadbrows">
          <path class="m-line thin" d="M64 84 L88 78"/>
          <path class="m-line thin" d="M136 84 L112 78"/>
        </g>
        <path class="m-tear" d="M66 120 q-4 8 0 11 q4 -3 0 -11Z"/>
        <path class="m-sweat" d="M146 80 q-5 9 0 12 q5 -3 0 -12Z"/>
        <ellipse class="m-blush" cx="62" cy="128" rx="9" ry="5"/>
        <ellipse class="m-blush" cx="138" cy="128" rx="9" ry="5"/>
        <path class="m-nose" d="M96 121 Q100 126 104 121 Q100 119 96 121Z"/>
        <g class="m-mouth"></g>
      </g>
    </g>
  </g>
  <g class="m-zzz"><text x="150" y="60">z</text><text x="162" y="44">z</text><text x="172" y="28">Z</text></g>
</svg>`;
  }

  window.Monster = {
    render(el) {
      el.innerHTML = svg("mon") + '<div class="confetti" aria-hidden="true"></div>';
    },
    setMood(el, mood) {
      el.dataset.mood = mood;
      const mouth = el.querySelector(".m-mouth");
      if (mouth) mouth.innerHTML = MOUTHS[mood] || MOUTHS.happy;
    },
    confetti(el) {
      const box = el.querySelector(".confetti");
      if (!box) return;
      box.innerHTML = "";
      const colors = ["#ff7cc8", "#a66bff", "#ffd166", "#5fd3c6", "#ff9f6e"];
      for (let i = 0; i < 28; i++) {
        const s = document.createElement("i");
        s.style.left = Math.random() * 100 + "%";
        s.style.background = colors[i % colors.length];
        s.style.animationDelay = Math.random() * 0.4 + "s";
        s.style.setProperty("--dx", (Math.random() * 80 - 40) + "px");
        s.style.setProperty("--rot", Math.random() * 720 + "deg");
        box.appendChild(s);
      }
      setTimeout(() => (box.innerHTML = ""), 2600);
    },
    iconSvg: svg
  };
})();
