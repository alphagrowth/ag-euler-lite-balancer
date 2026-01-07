# Euler Lite

## 🎯 Overview

Euler Lite provides all the core functionality of Euler Finance in a customizable package:

- **Lending & Borrowing**: Users can deposit assets to earn yield or borrow against collateral
- **Portfolio Management**: Track positions and performance
- **Rewards**: Participate in Merkl/Brevis reward programs
- **Multi-chain Support**: Connect to multiple EVM-compatible networks

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 18+ (recommended: 20.12.2)
- **npm** or **yarn** package manager
- **Git**
- A **Reown Project ID** (formerly WalletConnect) - get one at [reown.com](https://reown.com/)
- Your domain URL where the app will be hosted

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd euler-lite
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root directory with the following variables:

```bash
# Network configuration (required)
NETWORK=mainnet  # or testnet

# Pyth Hermes URL (optional, defaults to https://hermes.pyth.network)
PYTH_HERMES_URL=https://hermes.pyth.network

# HTTPS configuration for local development (optional)
HTTPS_KEY=/path/to/key.pem
HTTPS_CERT=/path/to/cert.pem
```

**Note**: The `NETWORK` variable is required. Other variables are optional and have sensible defaults.

### 3. Customize Your Instance

The most important step is customizing your instance to match your brand and requirements.

#### 3.1. App Branding (`entities/custom.ts`)

Open `entities/custom.ts` and configure the following:

**Social Links** - Update with your social media profiles:

```typescript
export const socials = {
  x: "https://x.com/yourhandle",
  discord: "https://discord.com/invite/yourserver",
  telegram: "https://t.me/yourchannel",
  github: "https://github.com/yourorg",
} as const;
```

**Documentation & Legal Links** - Set your documentation and terms:

```typescript
export const links = [
  {
    title: "Docs",
    url: "https://your-docs-url.com",
  },
  {
    title: "Terms of Use",
    url: "https://your-terms-url.com",
  },
] as const;
```

**Theme Color** - Customize your brand color (hue in degrees, 0-360):

```typescript
export const themeHue = 150; // Change to your brand color hue
```

**Supported Networks** - Configure which blockchain networks your instance supports:

```typescript
export const availableNetworkIds = [
  1, // Ethereum Mainnet
  42161, // Arbitrum
  8453, // Base
  // Add or remove network IDs as needed
] as const;
```

**Euler Labels Repository** - Set the GitHub repository for Euler labels:

```typescript
export const labelsRepo: string = "euler-xyz/euler-labels"; // or your fork
```

**Intrinsic APY** - Enable/disable DeFiLlama integration:

```typescript
export const enableIntrinsicApy = true; // Set to false to disable
```

#### 3.2. Wagmi Configuration (`plugins/00.wagmi.ts`)

Open `plugins/00.wagmi.ts` and update:

**Reown Project ID** - Replace with your own project ID:

```typescript
const projectId = "your-reown-project-id"; // Get from https://reown.com/
```

**App URL** - Set your domain URL:

```typescript
const url = "https://your-domain.com";
```

**App Metadata** - Update the app name and description:

```typescript
const metadata = {
  name: "Your App Name",
  description: "Your app description",
  url,
  icons: [`${url}/manifest-img.png`],
};
```

#### 3.3. App Title and Favicon (`nuxt.config.ts`)

Open `nuxt.config.ts` and update:

**App Title** - Change the title shown in browser tabs:

```typescript
app: {
  head: {
    title: 'Your App Name',  // Update this
    // ...
  }
}
```

**Favicon** - Replace the favicon files in `public/favicons/`:

- `favicon.ico`
- `favicon.svg`
- `favicon-96x96.png`

The favicon paths are already configured in `nuxt.config.ts` to point to `/favicons/favicon.ico`.

**Theme Color** - Update the theme color meta tag:

```typescript
meta: [
  // ...
  {
    name: "theme-color",
    content: "#your-color", // Update to match your brand
  },
];
```

#### 3.4. Token Icons (Optional)

If your vaults use specific tokens that aren't already provided by Euler Indexer (see composables/useTokens.ts), add their icons to `public/tokens/`:

1. Add token icon files (PNG format recommended) to `public/tokens/`
2. Name them using the symbol name in lowercase (e.g., `eth.png`)
3. The app will automatically use these icons when displaying tokens (as a fallback)

### 4. Development

Start the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:3000` (or the next available port).

### 5. Build for Production

Build the application:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## 🐳 Docker Deployment

The project includes a Dockerfile for containerized deployment:

```bash
# Build the Docker image
docker build --build-arg APP_PORT=3000 -t euler-lite .

# Run the container
docker run -p 3000:3000 \
  -e NETWORK=mainnet \
  -e PYTH_HERMES_URL=https://hermes.pyth.network \
  euler-lite
```

## 📁 Project Structure

Key directories and files:

- `composables/` - Vue composables for app logic (vaults, tokens, operations, etc.)
- `components/` - Vue components organized by feature
- `entities/` - Type definitions and configuration
  - `custom.ts` - **Your main customization file**
- `pages/` - Nuxt pages/routes
- `plugins/` - Nuxt plugins
  - `00.wagmi.ts` - **Wagmi/Reown configuration**
- `public/` - Static assets
  - `favicons/` - **Favicon files**
  - `tokens/` - **Token icon files**
- `nuxt.config.ts` - **Nuxt configuration (title, favicon)**

## 🔧 Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run generate` - Generate static site
- `npm run postinstall` - Prepare Nuxt (runs automatically after install)

## ⚙️ Configuration Checklist

Before deploying, ensure you've completed:

- [ ] Created `.env` file with `NETWORK` variable
- [ ] Updated social links in `entities/custom.ts`
- [ ] Updated documentation and terms links in `entities/custom.ts`
- [ ] Set theme color hue in `entities/custom.ts`
- [ ] Configured supported networks in `entities/custom.ts`
- [ ] Updated Euler labels repository in `entities/custom.ts` (if using custom labels)
- [ ] Set Reown Project ID in `plugins/00.wagmi.ts`
- [ ] Updated app URL in `plugins/00.wagmi.ts`
- [ ] Updated app metadata (name, description) in `plugins/00.wagmi.ts`
- [ ] Changed app title in `nuxt.config.ts`
- [ ] Replaced favicon files in `public/favicons/`
- [ ] Updated theme color in `nuxt.config.ts`
- [ ] Added custom token icons to `public/tokens/` (if needed)

## 🆘 Troubleshooting

### Build Errors

- Ensure Node.js version is 18+ (20.12.2 recommended)
- Clear `node_modules` and reinstall: `rm -rf node_modules && npm install`
- Check TypeScript compilation errors

### Wallet Connection Issues

- Verify Reown Project ID is correct
- Ensure app URL matches your domain
- Check browser console for errors
- Verify network IDs in `entities/custom.ts` match supported networks

### Network Configuration

- Ensure `NETWORK` environment variable is set correctly
- Verify network IDs in `availableNetworkIds` are valid
- Check that network configurations match your deployment environment

## 📚 Additional Resources

- [Nuxt.js Documentation](https://nuxt.com/docs)
- [Reown (WalletConnect) Documentation](https://docs.reown.com/)
- [Euler Finance Documentation](https://docs.euler.finance/)

## 🤝 Support

For issues specific to Euler Lite, please refer to the main Euler protocol documentation or reach out to the Euler team.
