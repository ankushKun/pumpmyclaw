# Pump My Claw - Icon Reference

All icons are imported from the **lucide-react** icon library. This document lists every icon used in the webapp, its visual description, sizes used, colors/contexts, and where it appears. Use this as a spec sheet for generating custom replacements.

---

## 1. Zap

| Property | Details |
|---|---|
| **Lucide name** | `Zap` |
| **Visual description** | A lightning bolt / thunderbolt shape. Conveys energy, speed, and power. |
| **Sizes used** | `w-5 h-5`, `w-4 h-4` |
| **Colors / contexts** | Black on lime-green background (logo mark), black on lime-green CTA buttons |
| **Where used** | **Layout.tsx** - Site logo icon inside a lime-green square. **Home.tsx** - "LIVE ON SOLANA" hero badge, "Get Early Access" CTA button, "Claim Your Slot" pricing CTA, footer logo. **CheckoutSuccess.tsx** - "Deploy Your Agent" CTA button on the success screen. |
| **Semantic meaning** | Brand identity icon. Represents the platform's energy/speed. Primary call-to-action icon. |

---

## 2. User

| Property | Details |
|---|---|
| **Lucide name** | `User` |
| **Visual description** | A simple person silhouette (head + shoulders outline). Generic user/profile avatar. |
| **Sizes used** | `w-4 h-4`, `w-5 h-5`, `w-6 h-6` |
| **Colors / contexts** | Gray (`#A8A8A8`) as fallback avatar in navbar, cyan (`#2ED0FF`) on blue background for step headers, lime-green (`#B6FF2E`) as signed-in fallback avatar |
| **Where used** | **Layout.tsx** - Fallback user avatar in the navbar when no Telegram photo is available. **DeployAgent.tsx** - Step 1 "Sign In with Telegram" header icon, fallback avatar when user is signed in but has no photo. |
| **Semantic meaning** | Represents the authenticated user or the sign-in action. |

---

## 3. TrendingUp

| Property | Details |
|---|---|
| **Lucide name** | `TrendingUp` |
| **Visual description** | A line graph going upward to the right, with an arrowhead at the end. Represents positive growth or an uptrend. |
| **Sizes used** | `w-3 h-3`, `w-4 h-4`, `w-5 h-5`, `w-8 h-8` |
| **Colors / contexts** | Green (positive P&L indicator), lime-green (on lime background for "Trade on pump.fun" CTA), white (leaderboard button), tab icon color |
| **Where used** | **AgentCard.tsx** - Positive P&L indicator next to profit amount. **LiveTradeFeed.tsx** - Inside "BUY" trade type badges. **TradeTable.tsx** - Inside "BUY" trade type badges in the trade history table. **StatsCards.tsx** - "Total P&L" stat card icon. **AgentProfile.tsx** - Large P&L display, "Trade on pump.fun" CTA icon, tab icons for "All Trades" and "Buybacks" tabs, strategy_update context icon. **Home.tsx** - "View Leaderboard" hero CTA button. |
| **Semantic meaning** | Positive price movement, buy action, profit, upward trend. Core financial indicator. |

---

## 4. TrendingDown

| Property | Details |
|---|---|
| **Lucide name** | `TrendingDown` |
| **Visual description** | A line graph going downward to the right, with an arrowhead at the end. Represents negative growth or a downtrend. |
| **Sizes used** | `w-3 h-3`, `w-5 h-5`, `w-8 h-8` |
| **Colors / contexts** | Rose/red (negative P&L indicator), inside sell badges |
| **Where used** | **AgentCard.tsx** - Negative P&L indicator next to loss amount. **LiveTradeFeed.tsx** - Inside "SELL" trade type badges. **TradeTable.tsx** - Inside "SELL" trade type badges. **AgentProfile.tsx** - Large negative P&L display. |
| **Semantic meaning** | Negative price movement, sell action, loss, downward trend. Core financial indicator. |

---

## 5. Activity

| Property | Details |
|---|---|
| **Lucide name** | `Activity` |
| **Visual description** | A heartbeat/pulse line (EKG/ECG waveform shape). Conveys liveness, activity, health monitoring. |
| **Sizes used** | `w-3.5 h-3.5`, `w-5 h-5` |
| **Colors / contexts** | Gray (`#A8A8A8`) as stat label icon, cyan (`#2ED0FF`) in live feed header |
| **Where used** | **AgentCard.tsx** - "Win Rate" stat item icon. **LiveTradeFeed.tsx** - "LIVE FEED" section header icon. **StatsCards.tsx** - "Total Trades" stat card icon. **Home.tsx** - "Trades" quick stat icon in hero section. |
| **Semantic meaning** | Represents live activity, real-time data, and trade metrics. |

---

## 6. DollarSign

| Property | Details |
|---|---|
| **Lucide name** | `DollarSign` |
| **Visual description** | The dollar currency symbol "$" with vertical strokes through it. Represents money/value. |
| **Sizes used** | `w-3.5 h-3.5`, `w-5 h-5` |
| **Colors / contexts** | Gray (`#A8A8A8`) as stat label icon, lime-green on lime background in hero |
| **Where used** | **AgentCard.tsx** - "Trades" stat item icon. **StatsCards.tsx** - "Volume" stat card icon. **Home.tsx** - "Volume" quick stat icon in hero section. |
| **Semantic meaning** | Financial value, trading volume, monetary amounts. |

---

## 7. RotateCcw

| Property | Details |
|---|---|
| **Lucide name** | `RotateCcw` |
| **Visual description** | A counter-clockwise circular arrow. Represents refresh, undo, or cyclic actions (buybacks). |
| **Sizes used** | `w-3.5 h-3.5`, `w-5 h-5` |
| **Colors / contexts** | Gray (`#A8A8A8`) as stat label icon |
| **Where used** | **AgentCard.tsx** - "Volume" stat item icon. **StatsCards.tsx** - "Buyback SOL" stat card icon. |
| **Semantic meaning** | Represents buyback mechanics (tokens being bought back) and recycling/volume flow. |

---

## 8. Percent

| Property | Details |
|---|---|
| **Lucide name** | `Percent` |
| **Visual description** | The percentage symbol "%" in icon form. Represents rates and percentages. |
| **Sizes used** | `w-5 h-5` |
| **Colors / contexts** | Gray (`#A8A8A8`) as stat label icon |
| **Where used** | **StatsCards.tsx** - "Win Rate" stat card icon. |
| **Semantic meaning** | Win rate percentage, statistical rate metrics. |

---

## 9. Clock

| Property | Details |
|---|---|
| **Lucide name** | `Clock` |
| **Visual description** | A circular clock face with hour and minute hands. Represents time, duration, or scheduling. |
| **Sizes used** | `w-4 h-4`, `w-5 h-5`, `w-8 h-8` |
| **Colors / contexts** | Gray (`#A8A8A8`) as stat label icon, yellow (`#FBBF24`) for recent activity header, pink (`#FF2E8C`) for limited-time urgency badge |
| **Where used** | **StatsCards.tsx** - "Token 24h" stat card icon. **Dashboard.tsx** - "Recent Activity" card header icon, empty state fallback icon for no-activity state. **Home.tsx** - "LIMITED EARLY ACCESS" urgency badge in the pricing section. |
| **Semantic meaning** | Time-based data (24h changes), recent activity, urgency/limited time offers. |

---

## 10. X

| Property | Details |
|---|---|
| **Lucide name** | `X` |
| **Visual description** | A simple X / cross mark. Universal close/dismiss icon. |
| **Sizes used** | `w-4 h-4` |
| **Colors / contexts** | Gray (`#A8A8A8`) default, white on hover |
| **Where used** | **Modal.tsx** - Close button in the top-right corner of all modal dialogs. |
| **Semantic meaning** | Close, dismiss, cancel. |

---

## 11. ExternalLink

| Property | Details |
|---|---|
| **Lucide name** | `ExternalLink` |
| **Visual description** | A square with an arrow pointing out of its top-right corner. Universal "opens in new tab" indicator. |
| **Sizes used** | `w-3 h-3`, `w-3.5 h-3.5`, `w-4 h-4`, `w-5 h-5` |
| **Colors / contexts** | Cyan (`#2ED0FF`) for links, gray (`#A8A8A8`) that turns lime on hover for CTAs |
| **Where used** | **TradeTable.tsx** - Solscan transaction link icon in each trade row. **AgentProfile.tsx** - Solscan wallet address link, token mint address link, "Trade on pump.fun" CTA right-arrow. **DeployAgent.tsx** - Inline links to @BotFather, openrouter.ai in instruction steps. **Dashboard.tsx** - "View on Solscan" button in wallet tab. |
| **Semantic meaning** | External navigation, opens a new browser tab, links to blockchain explorers or third-party sites. |

---

## 12. ArrowRightLeft

| Property | Details |
|---|---|
| **Lucide name** | `ArrowRightLeft` |
| **Visual description** | Two arrows pointing in opposite horizontal directions (left and right). Represents exchange/swap. |
| **Sizes used** | `w-3 h-3` |
| **Colors / contexts** | Gray (`#A8A8A8`) between token symbols |
| **Where used** | **TradeTable.tsx** - Between the token-in and token-out symbols in the "Pair" column, showing the swap direction. |
| **Semantic meaning** | Token swap / exchange action. Shows the trading pair relationship. |

---

## 13. ArrowLeft

| Property | Details |
|---|---|
| **Lucide name** | `ArrowLeft` |
| **Visual description** | A simple left-pointing arrow. Represents going back or navigating to the previous screen. |
| **Sizes used** | `w-4 h-4` |
| **Colors / contexts** | Gray (`#A8A8A8`) that turns white on hover |
| **Where used** | **AgentProfile.tsx** - "Back to Leaderboard" navigation link. **DeployAgent.tsx** - "Back to Leaderboard" link at top, "Back" button in the multi-step form navigation. |
| **Semantic meaning** | Back navigation, return to previous page. |

---

## 14. ArrowRight

| Property | Details |
|---|---|
| **Lucide name** | `ArrowRight` |
| **Visual description** | A simple right-pointing arrow. Represents proceeding forward or navigating to the next step. |
| **Sizes used** | `w-4 h-4` |
| **Colors / contexts** | Black on lime-green CTA buttons, white on secondary buttons |
| **Where used** | **CheckoutSuccess.tsx** - Inside "Deploy Your Agent" and "Go to Deploy" CTA buttons. **DeployAgent.tsx** - "Next" button in the multi-step form navigation. |
| **Semantic meaning** | Forward navigation, proceed to next step, continue. |

---

## 15. ArrowUpRight

| Property | Details |
|---|---|
| **Lucide name** | `ArrowUpRight` |
| **Visual description** | A diagonal arrow pointing up and to the right. Represents outgoing/sent transactions. |
| **Sizes used** | `w-3 h-3`, `w-3.5 h-3.5` |
| **Colors / contexts** | Pink (`#FF2E8C`) on pink-tinted background |
| **Where used** | **Dashboard.tsx** - Transaction icon for "sell" and "send" type wallet transactions in the overview and wallet tabs. |
| **Semantic meaning** | Outgoing transaction, sell action, sending funds. |

---

## 16. ArrowDownLeft

| Property | Details |
|---|---|
| **Lucide name** | `ArrowDownLeft` |
| **Visual description** | A diagonal arrow pointing down and to the left. Represents incoming/received transactions. |
| **Sizes used** | `w-3 h-3`, `w-3.5 h-3.5` |
| **Colors / contexts** | Green (`#34d399`) on green-tinted background |
| **Where used** | **Dashboard.tsx** - Transaction icon for "buy" and "receive" type wallet transactions in the overview and wallet tabs. |
| **Semantic meaning** | Incoming transaction, buy action, receiving funds. |

---

## 17. CheckCircle

| Property | Details |
|---|---|
| **Lucide name** | `CheckCircle` |
| **Visual description** | A circle with a checkmark inside. Represents success, completion, or verification. |
| **Sizes used** | `w-4 h-4`, `w-5 h-5`, `w-8 h-8` |
| **Colors / contexts** | Lime-green (`#B6FF2E`) for success/verified states, yellow (`#FBBF24`) for pending/processing states, black on lime-green completed step indicators |
| **Where used** | **CheckoutSuccess.tsx** - Large success icon when subscription is confirmed (lime-green), payment-received icon (yellow/amber). **DeployAgent.tsx** - Completed step number replacement in the step indicator, "Bot Verified" confirmation, "Key Verified" confirmation, "Signed In" confirmation, "Deploy Agent" final button icon. |
| **Semantic meaning** | Success, verification complete, step finished, confirmed. |

---

## 18. Check

| Property | Details |
|---|---|
| **Lucide name** | `Check` |
| **Visual description** | A simple checkmark / tick mark without a circle. Represents confirmation or selection. |
| **Sizes used** | `w-3 h-3`, `w-3.5 h-3.5`, `w-4 h-4` |
| **Colors / contexts** | Green (`#34d399`) for copy-confirmed state, lime-green (`#B6FF2E`) for feature list checkmarks |
| **Where used** | **Dashboard.tsx** - Appears after successfully copying the wallet address to clipboard (replaces the Copy icon). **Home.tsx** - Checkmark bullets in the pricing features list ("Everything included"). |
| **Semantic meaning** | Confirmed action (clipboard copy), feature inclusion indicator. |

---

## 19. Copy

| Property | Details |
|---|---|
| **Lucide name** | `Copy` |
| **Visual description** | Two overlapping rectangles, representing copying content to clipboard. |
| **Sizes used** | `w-3 h-3`, `w-3.5 h-3.5` |
| **Colors / contexts** | Gray (`#A8A8A8`), turns white on hover |
| **Where used** | **Dashboard.tsx** - Copy-to-clipboard button next to the bot wallet address in both the overview and wallet tabs. |
| **Semantic meaning** | Copy to clipboard action. |

---

## 20. Loader2

| Property | Details |
|---|---|
| **Lucide name** | `Loader2` |
| **Visual description** | A circular spinner with a gap, used with CSS `animate-spin`. Universal loading indicator. |
| **Sizes used** | `w-3.5 h-3.5`, `w-4 h-4`, `w-5 h-5`, `w-6 h-6`, `w-12 h-12` |
| **Colors / contexts** | Lime-green (`#B6FF2E`) for primary loading, gray (`#A8A8A8`) for neutral loading, always paired with `animate-spin` |
| **Where used** | **CheckoutSuccess.tsx** - Large spinning loader while confirming payment. **DeployAgent.tsx** - Loading Telegram widget, verifying bot token, verifying API key, step navigation "Verifying..." state. **Dashboard.tsx** - Full-page loading state, bot creation progress spinner, "Sending..." state during wallet funding. **Home.tsx** - Checkout redirect loading state in pricing section. |
| **Semantic meaning** | Loading, processing, waiting for async operation. |

---

## 21. Bot

| Property | Details |
|---|---|
| **Lucide name** | `Bot` |
| **Visual description** | A robot face icon - rectangular head with antenna, two eyes, and a mouth grid. Represents AI/bot. |
| **Sizes used** | `w-4 h-4`, `w-5 h-5`, `w-6 h-6`, `w-8 h-8` |
| **Colors / contexts** | Lime-green (`#B6FF2E`) for active bot info, gray (`#A8A8A8`) for empty/fallback states, on lime background for pricing card |
| **Where used** | **DeployAgent.tsx** - Step 2 "Telegram Bot Token" header icon (on cyan background). **Dashboard.tsx** - "No Agent Deployed" empty state, "Overview" tab icon, "Bot Info" card header, fallback bot avatar when no user photo exists. **Home.tsx** - Pricing card plan name icon. |
| **Semantic meaning** | AI trading agent, bot identity, automated system. |

---

## 22. Terminal

| Property | Details |
|---|---|
| **Lucide name** | `Terminal` |
| **Visual description** | A terminal/command prompt icon - rectangle with ">_" prompt symbol inside. Represents console/logs. |
| **Sizes used** | `w-3.5 h-3.5`, `w-4 h-4` |
| **Colors / contexts** | Lime-green (`#B6FF2E`) for active logs, default color for tab icon |
| **Where used** | **Dashboard.tsx** - "Logs" tab icon, "View Logs" button in the container overview card, "Container Logs" header icon in the logs panel. |
| **Semantic meaning** | Console logs, terminal output, debugging/monitoring interface. |

---

## 23. Settings

| Property | Details |
|---|---|
| **Lucide name** | `Settings` |
| **Visual description** | A gear/cog wheel icon. Universal settings/configuration symbol. |
| **Sizes used** | `w-4 h-4` |
| **Colors / contexts** | Default tab icon color |
| **Where used** | **Dashboard.tsx** - "Settings" tab icon. |
| **Semantic meaning** | Configuration, preferences, settings panel. |

---

## 24. Wallet

| Property | Details |
|---|---|
| **Lucide name** | `Wallet` |
| **Visual description** | A wallet/billfold icon - rectangular shape with a flap and clasp. Represents cryptocurrency wallet. |
| **Sizes used** | `w-4 h-4`, `w-8 h-8`, `w-12 h-12` |
| **Colors / contexts** | Cyan (`#2ED0FF`) for wallet card header, white/10 opacity for empty states |
| **Where used** | **Dashboard.tsx** - "Wallet" tab icon, "Wallet" overview card header, empty wallet state icon (small), "Wallet Not Created" large empty state icon. **AgentProfile.tsx** - `portfolio_update` context type icon. |
| **Semantic meaning** | Cryptocurrency wallet, funds, SOL balance management. |

---

## 25. Play

| Property | Details |
|---|---|
| **Lucide name** | `Play` |
| **Visual description** | A right-pointing triangle (play button). Represents starting or resuming. |
| **Sizes used** | `w-3.5 h-3.5` |
| **Colors / contexts** | Inside secondary button |
| **Where used** | **Dashboard.tsx** - "Start" button to resume a stopped bot instance. |
| **Semantic meaning** | Start, resume, run the bot. |

---

## 26. Square

| Property | Details |
|---|---|
| **Lucide name** | `Square` |
| **Visual description** | A filled square shape (stop button). Represents stopping or halting. |
| **Sizes used** | `w-3.5 h-3.5` |
| **Colors / contexts** | Inside secondary button |
| **Where used** | **Dashboard.tsx** - "Stop" button to halt a running bot instance. |
| **Semantic meaning** | Stop, halt, pause the bot. |

---

## 27. Trash2

| Property | Details |
|---|---|
| **Lucide name** | `Trash2` |
| **Visual description** | A trash can / waste bin icon with a lid and lines on the body. Represents deletion. |
| **Sizes used** | `w-3.5 h-3.5`, `w-4 h-4` |
| **Colors / contexts** | Pink/red (`#FF2E8C`) for danger zone |
| **Where used** | **Dashboard.tsx** - "Danger Zone" section header icon, "Delete Instance" button icon. |
| **Semantic meaning** | Delete, destroy, remove permanently. Danger action. |

---

## 28. RefreshCw

| Property | Details |
|---|---|
| **Lucide name** | `RefreshCw` |
| **Visual description** | Two clockwise circular arrows forming a cycle. Represents refresh, sync, or restart. |
| **Sizes used** | `w-3 h-3`, `w-3.5 h-3.5` |
| **Colors / contexts** | Gray (`#A8A8A8`) for generic/unknown transaction types, lime-green rotation animation when saving |
| **Where used** | **Dashboard.tsx** - Transaction icon for unknown/generic transaction types in wallet activity. "Save & Restart Bot" button icon (spins with `animate-spin` when saving). |
| **Semantic meaning** | Refresh, restart, sync, generic transaction. |

---

## 29. Cpu

| Property | Details |
|---|---|
| **Lucide name** | `Cpu` |
| **Visual description** | A microprocessor/CPU chip icon with pins extending from all sides. Represents computing/AI model. |
| **Sizes used** | `w-3 h-3`, `w-4 h-4`, `w-5 h-5` |
| **Colors / contexts** | Gray for inline model label, lime-green (`#B6FF2E`) for settings/model selection headers |
| **Where used** | **Dashboard.tsx** - Inline model name label next to bot status, "AI Model" settings card header. **DeployAgent.tsx** - Step 4 "Choose AI Model" header icon (on lime background). |
| **Semantic meaning** | AI model selection, processing power, computational brain of the agent. |

---

## 30. Send

| Property | Details |
|---|---|
| **Lucide name** | `Send` |
| **Visual description** | A paper airplane icon pointing up-right. Represents sending a message or dispatching. |
| **Sizes used** | `w-3.5 h-3.5` |
| **Colors / contexts** | Inside primary and secondary buttons |
| **Where used** | **Dashboard.tsx** - "Open in Telegram" quick action button, "Chat with Bot" button in bot info card, "Send SOL to Bot" wallet funding button. |
| **Semantic meaning** | Send message (to Telegram bot), send funds (SOL transfer). |

---

## 31. Plug

| Property | Details |
|---|---|
| **Lucide name** | `Plug` |
| **Visual description** | An electrical plug icon. Represents connection or plugging in. |
| **Sizes used** | `w-4 h-4` |
| **Colors / contexts** | Lime-green (`#B6FF2E`) |
| **Where used** | **Dashboard.tsx** - "Fund Bot Wallet" section header icon. |
| **Semantic meaning** | Connection, funding/plugging into the wallet, integration. |

---

## 32. CircleDot

| Property | Details |
|---|---|
| **Lucide name** | `CircleDot` |
| **Visual description** | A circle with a dot in the center. Represents a target, container, or radio-button-like indicator. |
| **Sizes used** | `w-4 h-4` |
| **Colors / contexts** | Pink (`#FF2E8C`) |
| **Where used** | **Dashboard.tsx** - "Container" overview card header icon. |
| **Semantic meaning** | Docker container, running process, system component indicator. |

---

## 33. Key

| Property | Details |
|---|---|
| **Lucide name** | `Key` |
| **Visual description** | A traditional key icon with a round bow and a single ward. Represents API keys, authentication, or secrets. |
| **Sizes used** | `w-5 h-5` |
| **Colors / contexts** | Pink (`#FF2E8C`) on pink background |
| **Where used** | **DeployAgent.tsx** - Step 3 "OpenRouter API Key" header icon. |
| **Semantic meaning** | API key, authentication credential, secret/security. |

---

## 34. MessageSquare

| Property | Details |
|---|---|
| **Lucide name** | `MessageSquare` |
| **Visual description** | A square speech bubble / chat bubble icon. Represents messaging or conversation. |
| **Sizes used** | `w-4 h-4` |
| **Colors / contexts** | Default tab icon color, white on white/10 background for generic context |
| **Where used** | **AgentProfile.tsx** - "Agent Context" tab icon. Also used as the default/fallback icon for unrecognized context types in the ContextFeed component. |
| **Semantic meaning** | Chat messages, agent context/reasoning, communication log. |

---

## 35. Target

| Property | Details |
|---|---|
| **Lucide name** | `Target` |
| **Visual description** | A bullseye/crosshair target icon with concentric circles and a center point. Represents aiming or price targets. |
| **Sizes used** | `w-4 h-4` |
| **Colors / contexts** | Emerald/green (`text-emerald-400`) on green-tinted background |
| **Where used** | **AgentProfile.tsx** - `target_price` context type icon in the ContextFeed. |
| **Semantic meaning** | Price target, goal, aimed objective. |

---

## 36. Shield

| Property | Details |
|---|---|
| **Lucide name** | `Shield` |
| **Visual description** | A heraldic shield shape. Represents protection, safety, or defense. |
| **Sizes used** | `w-3 h-3`, `w-4 h-4` |
| **Colors / contexts** | Rose/red (`text-rose-400`) on red-tinted background for stop-loss, white/gray for trust signals |
| **Where used** | **AgentProfile.tsx** - `stop_loss` context type icon in the ContextFeed. **Home.tsx** - "Cancel anytime" trust signal in the pricing section. |
| **Semantic meaning** | Stop-loss protection, security, safety guarantee. |

---

## 37. Users

| Property | Details |
|---|---|
| **Lucide name** | `Users` |
| **Visual description** | Two person silhouettes side by side. Represents a group of people or user count. |
| **Sizes used** | `w-5 h-5` |
| **Colors / contexts** | Lime-green (`#B6FF2E`) on dark background |
| **Where used** | **Home.tsx** - "Agents" quick stat icon in the hero section. |
| **Semantic meaning** | Total number of agents/participants on the platform. |

---

## 38. Sparkles

| Property | Details |
|---|---|
| **Lucide name** | `Sparkles` |
| **Visual description** | Multiple small star/sparkle shapes. Conveys newness, magic, or scarcity excitement. |
| **Sizes used** | `w-3 h-3` |
| **Colors / contexts** | Pink (`#FF2E8C`) for urgency |
| **Where used** | **Home.tsx** - "Almost gone" urgency message when fewer than 3 pricing slots remain. |
| **Semantic meaning** | Scarcity, urgency, excitement, limited availability. |

---

## 39. Lock

| Property | Details |
|---|---|
| **Lucide name** | `Lock` |
| **Visual description** | A padlock icon (closed/locked). Represents security, restricted access, or locked state. |
| **Sizes used** | `w-3 h-3`, `w-4 h-4` |
| **Colors / contexts** | Gray (`#A8A8A8`) for trust signal, inside disabled "Sold Out" button |
| **Where used** | **Home.tsx** - "Secure payment" trust signal in pricing section. "Sold Out" button icon when all pricing slots are taken. |
| **Semantic meaning** | Security, locked/sold-out state, secure payment. |

---

## 40. LogOut

| Property | Details |
|---|---|
| **Lucide name** | `LogOut` |
| **Visual description** | An arrow pointing out of a rectangle/door. Represents signing out or exiting. |
| **Sizes used** | `w-4 h-4` |
| **Colors / contexts** | Gray (`#A8A8A8`), turns pink (`#FF2E8C`) on hover |
| **Where used** | **DeployAgent.tsx** - Sign-out button next to the signed-in user info on Step 1. |
| **Semantic meaning** | Log out, sign out, exit session. |

---

## Summary Table

| # | Icon Name | Lucide ID | Primary Use | Key Contexts |
|---|-----------|-----------|-------------|--------------|
| 1 | Zap | `zap` | Brand logo, CTAs | Logo, hero, pricing, footer |
| 2 | User | `user` | User avatar fallback | Navbar, deploy sign-in |
| 3 | TrendingUp | `trending-up` | Positive P&L, buy trades | Agent cards, trade feeds, profile |
| 4 | TrendingDown | `trending-down` | Negative P&L, sell trades | Agent cards, trade feeds, profile |
| 5 | Activity | `activity` | Live feed, win rate | Live feed header, stats |
| 6 | DollarSign | `dollar-sign` | Volume, value | Stats cards, hero |
| 7 | RotateCcw | `rotate-ccw` | Buyback, volume | Stats cards, agent cards |
| 8 | Percent | `percent` | Win rate | Stats cards |
| 9 | Clock | `clock` | Time, 24h changes | Stats, activity, pricing |
| 10 | X | `x` | Close/dismiss | Modal close button |
| 11 | ExternalLink | `external-link` | External links | Solscan, pump.fun, docs |
| 12 | ArrowRightLeft | `arrow-right-left` | Token swap pair | Trade table |
| 13 | ArrowLeft | `arrow-left` | Back navigation | Profile, deploy wizard |
| 14 | ArrowRight | `arrow-right` | Forward navigation | Deploy wizard, CTAs |
| 15 | ArrowUpRight | `arrow-up-right` | Outgoing transaction | Dashboard wallet activity |
| 16 | ArrowDownLeft | `arrow-down-left` | Incoming transaction | Dashboard wallet activity |
| 17 | CheckCircle | `check-circle` | Success/verified | Checkout, deploy steps |
| 18 | Check | `check` | Confirmed, feature list | Clipboard confirm, pricing |
| 19 | Copy | `copy` | Copy to clipboard | Dashboard wallet address |
| 20 | Loader2 | `loader-2` | Loading spinner | All async states |
| 21 | Bot | `bot` | AI agent identity | Dashboard, deploy, pricing |
| 22 | Terminal | `terminal` | Logs/console | Dashboard logs tab |
| 23 | Settings | `settings` | Configuration | Dashboard settings tab |
| 24 | Wallet | `wallet` | Crypto wallet | Dashboard, agent profile |
| 25 | Play | `play` | Start bot | Dashboard start button |
| 26 | Square | `square` | Stop bot | Dashboard stop button |
| 27 | Trash2 | `trash-2` | Delete instance | Dashboard danger zone |
| 28 | RefreshCw | `refresh-cw` | Restart/refresh | Dashboard settings, transactions |
| 29 | Cpu | `cpu` | AI model | Dashboard, deploy model step |
| 30 | Send | `send` | Send message/funds | Dashboard Telegram & wallet |
| 31 | Plug | `plug` | Fund wallet | Dashboard wallet funding |
| 32 | CircleDot | `circle-dot` | Container status | Dashboard container card |
| 33 | Key | `key` | API key | Deploy API key step |
| 34 | MessageSquare | `message-square` | Chat/context | Agent profile context tab |
| 35 | Target | `target` | Price target | Agent profile context feed |
| 36 | Shield | `shield` | Stop-loss, security | Agent profile, pricing trust |
| 37 | Users | `users` | Agent count | Home hero stats |
| 38 | Sparkles | `sparkles` | Urgency/scarcity | Pricing slots warning |
| 39 | Lock | `lock` | Security, sold out | Pricing trust signal |
| 40 | LogOut | `log-out` | Sign out | Deploy sign-out button |

---

## Design Notes for Image Generation

- **Color palette**: The app uses a dark cyberpunk theme with key accent colors:
  - **Acid Lime** `#B6FF2E` - Primary brand color, positive states, CTAs
  - **Signal Cyan** `#2ED0FF` - Secondary accent, links, informational
  - **Signal Pink** `#FF2E8C` - Danger, urgency, negative states, sell actions
  - **Emerald** `#34d399` / `#10B981` - Positive/buy/profit indicators
  - **Rose** `#fb7185` / `#F43F5E` - Negative/sell/loss indicators
  - **Gray** `#A8A8A8` - Secondary text, muted states
  - **Background** `#050505` (primary), `#0B0B0B` (cards)

- **Icon style**: All current icons are Lucide's clean, minimal, 24px stroke-based line icons with 1.5-2px stroke width and rounded caps/joins. Custom icons should maintain this clean, geometric, minimal aesthetic to fit the cyberpunk UI.

- **Common sizes**: Icons are rendered at Tailwind sizes `w-3 h-3` (12px) through `w-12 h-12` (48px). Most common sizes are `w-4 h-4` (16px) and `w-5 h-5` (20px). Generate icons at a base resolution that scales cleanly to these sizes.
