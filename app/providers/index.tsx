import { TitleBarContentProvider } from '~/components/app/title-bar';
import { ThemeProvider } from './theme';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TitleBarContentProvider>{children}</TitleBarContentProvider>
    </ThemeProvider>
  );
}
