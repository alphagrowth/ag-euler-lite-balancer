import { enableEarnPage, enableLendPage } from '~/entities/custom'

export interface MenuItem {
  name: string
  label: string
  icon: string
  activeIcon: string
}

const allMenuItems: MenuItem[] = [
  {
    name: 'portfolio',
    label: 'Portfolio',
    icon: 'portfolio-outline',
    activeIcon: 'portfolio-filled',
  },
  {
    name: 'earn',
    label: 'Earn',
    icon: 'earn-outline',
    activeIcon: 'earn-filled',
  },
  {
    name: 'lend',
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
]

export const menuItems = allMenuItems.filter((item) => {
  if (item.name === 'earn' && !enableEarnPage) return false
  if (item.name === 'lend' && !enableLendPage) return false
  return true
})

const preferredDefaultOrder = ['lend', 'earn', 'borrow', 'portfolio'] as const
export const defaultPageRoute = preferredDefaultOrder.find(name =>
  menuItems.some(item => item.name === name),
) ?? 'portfolio'
