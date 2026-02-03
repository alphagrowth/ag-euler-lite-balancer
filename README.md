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

# Reown (AppKit) configuration (required for wallet connect)
APPKIT_PROJECT_ID=your-reown-project-id
APP_URL=https://your-domain.com

# HTTPS configuration for local development (optional)
HTTPS_KEY=/path/to/key.pem
HTTPS_CERT=/path/to/cert.pem
```

**Note**: `NETWORK`, `APPKIT_PROJECT_ID`, and `APP_URL` are required. Other variables are optional and have sensible defaults.

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

**Theming System** - The app uses a comprehensive CSS variables-based theming system with light/dark mode support:

The theme is defined in `assets/styles/variables.scss` with the following color categories:

- **Primary colors** (`--primary-*`) - Navy blues for primary UI elements
- **Accent colors** (`--accent-*`) - Gold/bronze for CTAs and highlights
- **Neutral colors** (`--neutral-*`) - Warm grays for text and backgrounds
- **Semantic colors** (`--success-*`, `--warning-*`, `--error-*`) - Status indicators

**Customizing Colors**:

Edit `assets/styles/variables.scss` to change the color palette:

```scss
:root {
  // Primary - Navy (change these for your brand)
  --primary-500: #1e3a5f;
  --primary-600: #162d4d;
  
  // Accent - Gold/Bronze (for CTAs and highlights)
  --accent-500: #c49b64;
  --accent-600: #b08850;
  
  // ... other colors
}
```

**Dark Mode**:

Dark mode colors are defined in the `[data-theme="dark"]` block in `variables.scss`. The app includes a theme switcher (bottom-left corner) that toggles between light and dark modes, with the preference saved to localStorage.

**Semantic Theme Classes**:

The app uses semantic Tailwind classes that automatically adapt to the current theme:

| Class | Light Mode | Dark Mode |
|-------|------------|-----------|
| `bg-surface` | White | Dark gray |
| `bg-card` | White | Dark gray |
| `text-content-primary` | Near black | Near white |
| `text-content-secondary` | Medium gray | Light gray |
| `border-line-default` | Light gray | Dark gray |

**SEO Metadata** - Default page title and description for search/social previews:

```typescript
export const appTitle = "Your App Name";
export const appDescription = "Short SEO description of your app.";
```

These values are used in `nuxt.config.ts` for the document title, meta description, and Open Graph/Twitter tags.

**Onboarding Page** - Customize the onboarding screen that appears when users first visit your app:

```typescript
export const onboardingInfo = {
  logoUrl: "/logo.png", // Path to your logo image (relative to public/)
  title: "The Modular Credit Layer", // Main heading text
  description: "Lend, borrow and build without limits.", // Subheading text
};
```

**Configuration details**:

- `logoUrl` - Path to your logo image file. Place the image in the `public/` directory and reference it with a path starting with `/` (e.g., `/logo.png` for `public/logo.png`)
- `title` - The main heading displayed on the onboarding page
- `description` - The descriptive text shown below the title

The onboarding page is shown to users who haven't completed onboarding yet. Users can either connect their wallet or skip to continue without connecting.

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

**EulerEarn Vaults Configuration** - Specify which EulerEarn vaults to display in your app:

If you're using a custom labels repository (i.e., `labelsRepo` is not `"euler-xyz/euler-labels"`), you can curate which EulerEarn vaults are shown by creating chain-specific `earn-vaults.json` files in your labels repository.

**How it works**:

1. **Set your labels repository** in `entities/custom.ts` (if you haven't already):

   ```typescript
   export const labelsRepo: string = "your-username/your-labels-repo";
   ```

2. **Create chain-specific earn-vaults.json files** in your labels repository:

   - File path: `{chainId}/earn-vaults.json`
   - The file should be an array of vault addresses (strings)
   - Each supported chain needs its own file

3. **File structure example**:

   ```
   your-labels-repo/
   ├── 1/                    # Ethereum Mainnet (chainId: 1)
   │   └── earn-vaults.json
   ├── 42161/                # Arbitrum (chainId: 42161)
   │   └── earn-vaults.json
   └── 8453/                 # Base (chainId: 8453)
       └── earn-vaults.json
   ```

4. **earn-vaults.json format**:
   The file must be a JSON array of vault addresses (checksummed or lowercase):

   ```json
   [
     "0x1234567890123456789012345678901234567890",
     "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
     "0xFEDCBA9876543210FEDCBA9876543210FEDCBA98"
   ]
   ```

   **Example for Ethereum Mainnet** (`1/earn-vaults.json`):

   ```json
   [
     "0x7e7a0e85cc0c4b9db7b7b1c5a12d5d8e1f3c4a5b",
     "0x9f8c9e7d6b5a4c3b2a1f0e9d8c7b6a5f4e3d2c1",
     "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b"
   ]
   ```

**Important Notes**:

- Only vault addresses listed in `earn-vaults.json` will be displayed in your app's EulerEarn section
- If you're using the default `"euler-xyz/euler-labels"` repository, all verified EulerEarn vaults will be shown automatically
- The app loads `earn-vaults.json` from: `https://raw.githubusercontent.com/{labelsRepo}/refs/heads/master/{chainId}/earn-vaults.json`
- Each chain ID needs its own `earn-vaults.json` file in the corresponding directory
- Addresses will be normalized (checksummed) automatically, so you can use either lowercase or checksummed addresses

**Intrinsic APY** - Enable/disable DeFiLlama integration:

```typescript
export const enableIntrinsicApy = true; // Set to false to disable
```

**Intrinsic APY Sources (DefiLlama)** - Configure which tokens use DefiLlama base APY:

Sources live in `entities/custom.ts`:

```typescript
export const intrinsicApySources = [
  { symbol: "steth", project: "lido" },
  { symbol: "wsteth", sourceSymbol: "steth", project: "lido" },
  // Add your tokens here
] as const;
```

**How to add a token**:

1. `symbol` - the vault asset symbol (case-insensitive) used in the UI.
2. `project` - the DefiLlama project slug (from https://yields.llama.fi/pools).
3. `sourceSymbol` - optional; use when the vault asset is a wrapped token but APY is tied to another symbol.


#### 3.2. AppKit (Reown) Configuration

**Environment Variables** - Set these in your `.env`:

```bash
APPKIT_PROJECT_ID=your-reown-project-id  # Get from https://reown.com/
APP_URL=https://your-domain.com
```

**App Metadata** - Update the app name/description and icon path in `entities/custom.ts`:

```typescript
export const appKitMetadata = {
  name: "Your App Name",
  description: "Your app description",
  iconPath: "/manifest-img.png",
} as const;
```

The runtime AppKit metadata is assembled from `APP_URL` + `iconPath` in `plugins/00.wagmi.ts`.

#### 3.3. App Title, Description and Favicon (`nuxt.config.ts`)

Open `nuxt.config.ts` and update:

**App Title & Description (SEO)** - Update `appTitle` and `appDescription` in `entities/custom.ts`.
Nuxt uses those values for the document title and SEO meta tags.

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

The app uses a two-tier system for token icon resolution:

**Primary Source**: Token icons are automatically loaded from the Euler Indexer API (`https://indexer-main.euler.finance/v1/tokens`). The indexer provides token metadata including `logoURI` for each token based on the current chain ID.

**Fallback**: If a token doesn't have a `logoURI` from the indexer, the app falls back to custom icons in `public/tokens/`.

**How Token Icon Resolution Works**:

The `getAssetLogoUrl(symbol)` function in `composables/useTokens.ts` uses the following logic:

```typescript
export const getAssetLogoUrl = (symbol: string) => {
  return tokens[symbol]?.logoURI ?? `/tokens/${symbol}.png`;
};
```

1. **First**: Checks if the token (loaded from the indexer API for the current chain) has a `logoURI` property
2. **Fallback**: If no `logoURI` exists, looks for a file at `/tokens/${symbol}.png` in the `public` directory

**Adding Custom Token Icons**:

If you need to add custom token icons for tokens not provided by the Euler Indexer:

1. **File Location**: Add token icon files to `public/tokens/`
2. **File Naming**: Name files using the token's **symbol** in lowercase with `.png` extension
   - Example: `eth.png`, `usdc.png`, `wbtc.png`
3. **Not Chain-Specific**: Token icons are shared across all chains - the same `eth.png` file works for ETH on Ethereum Mainnet, Arbitrum, Base, etc.
4. **How It Works**: The app matches tokens by their `symbol` property (which is consistent across chains for the same asset), not by chain ID

**Example**:

- If a token with symbol `"MYTOKEN"` doesn't have a `logoURI` from the indexer, create `public/tokens/mytoken.png`
- This icon will be used whenever `getAssetLogoUrl("MYTOKEN")` is called, regardless of which chain the user is connected to

**Note**: Token data (including symbol) is loaded per-chain from the Euler Indexer API when users switch networks. The `useTokens` composable watches for chain changes and reloads tokens accordingly. Custom icons in `public/tokens/` are only used when the indexer doesn't provide a `logoURI` for that token symbol.

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

- `assets/styles/` - Global styles and theming
  - `variables.scss` - **Theme colors and CSS variables (light/dark mode)**
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
- `nuxt.config.ts` - **Nuxt configuration (SEO meta, favicon)**
- `tailwind.config.js` - **Tailwind CSS configuration with semantic theme classes**

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
- [ ] Customized theme colors in `assets/styles/variables.scss`
- [ ] Configured supported networks in `entities/custom.ts`
- [ ] Updated Euler labels repository in `entities/custom.ts` (if using custom labels)
- [ ] Set `APPKIT_PROJECT_ID` in `.env`
- [ ] Set `APP_URL` in `.env`
- [ ] Updated AppKit metadata (name, description, iconPath) in `entities/custom.ts`
- [ ] Set SEO title/description in `entities/custom.ts`
- [ ] Configured onboarding page (logo, title, description) in `entities/custom.ts`
- [ ] Replaced favicon files in `public/favicons/`
- [ ] Updated theme color meta tag in `nuxt.config.ts`
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
