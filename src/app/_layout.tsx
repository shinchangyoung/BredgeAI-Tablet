import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Text, TextInput, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { defaultTextStyle } from '@/constants/fonts';

let didConfigureDefaultFonts = false;
//폰트 설정
function configureDefaultFonts() {
  if (didConfigureDefaultFonts) return;

  const textDefaults = (Text as any).defaultProps ?? {};
  const textInputDefaults = (TextInput as any).defaultProps ?? {};

  (Text as any).defaultProps = {
    ...textDefaults,
    style: [defaultTextStyle, textDefaults.style],
  };
  (TextInput as any).defaultProps = {
    ...textInputDefaults,
    style: [defaultTextStyle, textInputDefaults.style],
  };
  didConfigureDefaultFonts = true;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    'Pretendard-Regular': require('@/assets/fonts/Pretendard-Regular.otf'),
    'Pretendard-Medium': require('@/assets/fonts/Pretendard-Medium.otf'),
    'Pretendard-SemiBold': require('@/assets/fonts/Pretendard-SemiBold.otf'),
    'Pretendard-Bold': require('@/assets/fonts/Pretendard-Bold.otf'),
    'Pretendard-ExtraBold': require('@/assets/fonts/Pretendard-ExtraBold.otf'),
    'Pretendard-Black': require('@/assets/fonts/Pretendard-Black.otf'),
  });

  if (!fontsLoaded) return null;
  configureDefaultFonts();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AppTabs />
    </ThemeProvider>
  );
}
