import React, { useEffect, useRef } from 'react';

/**
 * V26.0 — "The Nexus Gate" (Pillar 1): sfondo a rete neurale/ragnatela
 * tech, 100% Canvas2D procedurale (nessun asset esterno, stesso spirito
 * "zero file binari" del motore audio). Particelle che fluttuano lente e
 * si connettono con linee quando abbastanza vicine — la classica estetica
 * "constellation network", ritinteggiata nei toni Rosso Cremisi / Blu
 * Elettrico del Classic Suit per restare coerente col resto dell'app anche
 * PRIMA del login (quando il True Theme Engine non ha ancora un costume
 * attivo da leggere da `state.settings.suit`).
 *
 * Performance: un solo canvas, particelle aggiornate in un unico loop
 * `requestAnimationFrame`, connessioni calcolate con un semplice doppio
 * ciclo O(n²) — pienamente sostenibile per le ~70 particelle di un
 * background decorativo. Il loop si mette in pausa quando la tab non è
 * visibile (Page Visibility API), per non bruciare CPU/batteria a schermo
 * spento o su un'altra tab.
 */
const PARTICLE_COUNT = 70;
const MAX_LINK_DIST = 140;
const COLORS = [
  [226, 54, 54], // Attack — Rosso Cremisi
  [29, 131, 240] // Refuel — Blu Elettrico
];

function createParticle(width, height) {
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    r: 1 + Math.random() * 1.8,
    color
  };
}

export default function ParticleWeb({ className = '' }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const particlesRef = useRef([]);
  const runningRef = useRef(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let width = 0;
    let height = 0;
    let dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => createParticle(width, height));
    };

    resize();
    window.addEventListener('resize', resize);

    const handleVisibility = () => {
      runningRef.current = !document.hidden;
      if (runningRef.current && rafRef.current == null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    function tick() {
      if (!runningRef.current) {
        rafRef.current = null;
        return;
      }
      ctx.clearRect(0, 0, width, height);

      const particles = particlesRef.current;
      // Aggiorna posizioni, rimbalzo elastico sui bordi.
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x <= 0 || p.x >= width) p.vx *= -1;
        if (p.y <= 0 || p.y >= height) p.vy *= -1;
        p.x = Math.min(Math.max(p.x, 0), width);
        p.y = Math.min(Math.max(p.y, 0), height);
      }

      // Connessioni fra particelle vicine — alpha proporzionale alla distanza.
      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MAX_LINK_DIST) {
            const alpha = (1 - dist / MAX_LINK_DIST) * 0.35;
            const [r, g, bch] = a.color;
            ctx.strokeStyle = `rgba(${r}, ${g}, ${bch}, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Particelle stesse, come piccoli nodi luminosi.
      particles.forEach((p) => {
        const [r, g, b] = p.color;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.9)`;
        ctx.shadowBlur = 6;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.shadowBlur = 0;

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className={`block w-full h-full ${className}`} aria-hidden="true" />;
}
