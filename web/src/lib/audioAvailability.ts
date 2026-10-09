import { createContext, useContext } from "react";

/**
 * Whether the recipe page can play this recipe's audio. False in cloud mode on a device that
 * didn't upload the clip (audio never leaves the device it came from — see AudioNotOnDeviceError):
 * timestamp buttons and "Hear this step" hide themselves instead of doing nothing.
 */
export const AudioAvailableContext = createContext(true);

export function useAudioAvailable(): boolean {
  return useContext(AudioAvailableContext);
}
