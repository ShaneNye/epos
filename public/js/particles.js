        document.addEventListener("DOMContentLoaded", () => {
            const brandSide = document.querySelector(".brand-side");

            // cursor movement sparks
            brandSide.addEventListener("mousemove", (e) => {
                const rect = brandSide.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                // small burst of sparks (white only)
                for (let i = 0; i < 3; i++) {
                    spawnParticle(x, y, "rgba(255,255,255,0.9)");
                }
            });

            // click -> firework explosion
            brandSide.addEventListener("click", (e) => {
                const rect = brandSide.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                // bigger burst: alternating gold + white
                for (let i = 0; i < 45; i++) {
                    const color = i % 2 === 0 ? "var(--gold)" : "rgba(255,255,255,0.9)";
                    spawnParticle(x, y, color, true);
                }
            });

            // helper: create a particle at x,y
            function spawnParticle(x, y, color, isExplosion = false) {
                const particle = document.createElement("div");
                particle.className = "particle";
                particle.style.left = `${x}px`;
                particle.style.top = `${y}px`;
                particle.style.background = color;

                // random radial direction
                const angle = Math.random() * Math.PI * 2;
                const distance = isExplosion
                    ? Math.random() * 200 + 40 // bigger spread for fireworks
                    : Math.random() * 40;      // subtle sparks for cursor trail

                const dx = Math.cos(angle) * distance + "px";
                const dy = Math.sin(angle) * distance + "px";
                particle.style.setProperty("--dx", dx);
                particle.style.setProperty("--dy", dy);

                // explosions last longer
                particle.style.animationDuration = isExplosion ? "2.2s" : "1s";

                brandSide.appendChild(particle);

                // remove when animation ends
                setTimeout(() => {
                    particle.remove();
                }, isExplosion ? 2200 : 1000);
            }
        });
