import { Toaster as Sonner } from "sonner"
import { useTheme } from "../../context/ThemeContext"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()

  return (
    <Sonner
      theme={theme}
      position="top-right"
      toastOptions={{
        style: {
          background: theme === 'dark' ? 'var(--color-bg-elevated)' : '#ffffff',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text)',
          fontSize: '14px',
          borderRadius: '10px',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08)',
          padding: '16px',
          lineHeight: '1.5',
          zIndex: 'var(--z-toast)',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
