# Getting Started

Welcome to the Euler Lite project! This guide will help you get up and running with the development environment and understand the basics of the project.

## 🎯 What is Euler Lite?

**Euler Lite** is a lightweight multi-chain DeFi application that provides access to Euler Finance's lending and borrowing services. It supports multiple EVM chains and connects via standard EVM wallets.

### Key Features

- **Lending**: Users can deposit assets to earn yield
- **Borrowing**: Users can borrow assets using collateral
- **Portfolio Management**: Track positions and performance
- **Rewards**: Participate in Merkl reward programs
- **Cross-chain**: Bridge between TON and EVM-compatible chains using TAC

## 🏗️ Technology Stack

### Frontend Framework

- **Nuxt.js 3**: Full-stack Vue.js framework
- **Vue 3**: Progressive JavaScript framework with Composition API
- **TypeScript**: Type-safe JavaScript development
- **SCSS**: Advanced CSS preprocessing with custom design system

### Blockchain & DeFi

- **TON Blockchain**: Native blockchain integration
- **TAC (TON App Chain)**: EVM-compatible layer for cross-chain operations
- **Euler Finance**: DeFi lending and borrowing protocol
- **TonConnect**: TON wallet integration
- **Ethers.js**: Ethereum/EVM interaction library

### Development Tools

- **ESLint**: Code quality and consistency
- **VueUse**: Vue composition utilities

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn package manager
- Git
- Basic knowledge of Vue.js and TypeScript

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd euler-lite
   ```

2. **Install dependencies**

   ```bash
   npm install
   # or
   yarn install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start development server**

   ```bash
   npm run dev
   # or
   yarn dev
   ```

5. **Open your browser**
   Navigate to `http://localhost:3000`

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run generate` - Generate static site
- `npm run lint` - Run ESLint

## 🌍 Environment Configuration

The application supports multiple environments (testnet/mainnet) and requires several configuration variables:

### Required Environment Variables

```bash
# Network configuration
NETWORK=testnet  # or mainnet

# Analytics (optional)
TGA_TOKEN=your_token
TGA_NAME=your_name
```

## 🔗 Key External Services

### Euler Finance

- **Purpose**: DeFi lending and borrowing protocol
- **Integration**: Smart contract interactions via EVM
- **Data Source**: Vault information, interest rates, positions

### TON Blockchain

- **Purpose**: Native blockchain for wallet connections
- **Integration**: TonConnect SDK, TON address management
- **Data Source**: Wallet balances, transaction history

### TAC (TON App Chain)

- **Purpose**: EVM-compatible layer for cross-chain operations
- **Integration**: TAC SDK for smart account management
- **Data Source**: Cross-chain transactions, account states

### Merkl

- **Purpose**: Reward distribution and management
- **Integration**: API for opportunities and rewards
- **Data Source**: Campaign information, user rewards

## 🆘 Common Issues

### Build Errors

- Ensure Node.js version is 18+
- Clear `node_modules` and reinstall dependencies
- Check TypeScript compilation errors

### Blockchain Connection Issues

- Verify environment variables are set correctly
- Check network configuration (testnet vs mainnet)
- Ensure RPC endpoints are accessible

### Wallet Connection Problems

- Verify TonConnect manifest configuration
- Check browser console for errors
- Ensure Telegram Web App is properly configured

## 🤝 Getting Help

- **Documentation**: Check other sections of this documentation
- **Code Issues**: Look at existing components and composables
- **Team Support**: Reach out to the development team

---

_Next: Continue to the [Architecture Overview](./architecture.md) to learn the system design._
