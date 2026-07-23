import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const easeOut = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * Internal timing board for the website hero.
 *
 * This is intentionally a motion study, not a wedding movie. It renders a
 * representative frame so the web implementation can borrow the same
 * entrance pacing while the actual experience remains native HTML/CSS.
 */
export function PersonalAtlasMotionStudy() {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        display: "grid",
        gridTemplateColumns: "43% 57%",
        overflow: "hidden",
        backgroundColor: "#f6f0e4",
        color: "#282521",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "74px 68px 56px",
          opacity: interpolate(frame, [4, 25], [0, 1], {
            easing: easeOut,
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: `0 ${interpolate(frame, [4, 25], [34, 0], {
            easing: easeOut,
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          <span>0719 + co.</span>
          <span>Santa Barbara</span>
        </div>

        <div style={{ display: "grid", gap: 28 }}>
          <span
            style={{
              color: "#6b645a",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            July 19, 2025 · A personal atlas
          </span>
          <div
            style={{
              maxWidth: 570,
              fontFamily: "Georgia, serif",
              fontSize: 100,
              fontWeight: 400,
              letterSpacing: "-0.065em",
              lineHeight: 0.86,
            }}
          >
            From the coast
            <span style={{ display: "block", fontStyle: "italic" }}>
              to the dance floor
            </span>
          </div>
          <p
            style={{
              maxWidth: 500,
              margin: 0,
              fontFamily: "Georgia, serif",
              fontSize: 25,
              lineHeight: 1.5,
            }}
          >
            Surrounded by all of our favorite people in one of our favorite places.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            alignItems: "center",
            gap: 24,
            fontSize: 14,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          <div
            style={{
              height: 1,
              scale: `${interpolate(frame, [20, 58], [0, 1], {
                easing: Easing.bezier(0.45, 0, 0.55, 1),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })} 1`,
              transformOrigin: "left center",
              backgroundColor: "#d8c8a8",
            }}
          />
          <span>Find your place in the weekend</span>
        </div>
      </div>

      <div style={{ position: "relative", overflow: "hidden", backgroundColor: "#e8dbc2" }}>
        <Img
          src={staticFile("story/hero-sunset-a6fa78bb.jpg")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "52% 46%",
            opacity: interpolate(frame, [0, 18], [0, 1], {
              easing: easeOut,
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            scale: interpolate(frame, [0, 72], [1.045, 1], {
              easing: Easing.bezier(0.45, 0, 0.55, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 26,
            bottom: 24,
            left: 26,
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: 28,
            padding: "16px 18px",
            backgroundColor: "rgba(246, 240, 228, 0.92)",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.11em",
            textTransform: "uppercase",
            opacity: interpolate(frame, [24, 46], [0, 1], {
              easing: easeOut,
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: `0 ${interpolate(frame, [24, 46], [18, 0], {
              easing: easeOut,
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}px`,
          }}
        >
          <span>01</span>
          <span>Santa Barbara, California</span>
          <span style={{ color: "#6b645a" }}>34.4208° N · 119.6982° W</span>
        </div>
      </div>
    </AbsoluteFill>
  );
}
