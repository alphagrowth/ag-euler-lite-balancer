export interface MenuItem {
  name: string
  label: string
  icon: string
  activeIcon: string
}

export const menuItems: MenuItem[] = [
  {
    name: 'earn',
    label: 'Earn',
    icon: 'earn-outline',
    activeIcon: 'earn-filled',
  },
  {
    name: 'index',
    label: 'Lend',
    icon: 'lend-outline',
    activeIcon: 'lend-filled',
  },
  {
    name: 'borrow',
    label: 'Borrow',
    icon: 'borrow-outline',
    activeIcon: 'borrow-filled',
  },
  {
    name: 'portfolio',
    label: 'Portfolio',
    icon: 'portfolio-outline',
    activeIcon: 'portfolio-filled',
  },
]
