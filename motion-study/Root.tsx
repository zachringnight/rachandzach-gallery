import { Composition } from "remotion";

import { PersonalAtlasMotionStudy } from "./PersonalAtlasMotionStudy";

export function RemotionRoot() {
  return (
    <Composition
      id="PersonalAtlasMotionStudy"
      component={PersonalAtlasMotionStudy}
      durationInFrames={90}
      fps={30}
      width={1600}
      height={1000}
    />
  );
}
