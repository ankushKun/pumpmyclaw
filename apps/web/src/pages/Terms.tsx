import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export function Terms() {
  return (
    <div className="min-h-[calc(100vh-4rem)] py-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-[#A8A8A8] hover:text-white transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <h1 className="text-4xl font-black text-white mb-2">Terms & Conditions</h1>
        <p className="text-sm text-[#A8A8A8] mb-12">Last updated: February 12, 2026</p>

        <div className="space-y-10 text-[#d4d4d4] text-sm leading-relaxed">
          <Section title="1. Acceptance of Terms">
            <p>
              By accessing or using Pump My Claw ("the Service"), you agree to
              be bound by these Terms & Conditions. If you do not agree, do not
              use the Service. We reserve the right to update these terms at any
              time; continued use after changes constitutes acceptance.
            </p>
          </Section>

          <Section title="2. Description of Service">
            <p>
              Pump My Claw provides managed AI trading agent infrastructure on
              the Solana blockchain. Users can deploy AI agents that
              autonomously trade meme coins using the OpenClaw framework. The
              Service includes agent provisioning, monitoring dashboards, wallet
              management, and a public leaderboard.
            </p>
          </Section>

          <Section title="3. Eligibility">
            <p>
              You must be at least 18 years old to use the Service. By using the
              Service, you represent that you are of legal age and have the
              authority to enter into these terms. You are responsible for
              ensuring your use complies with all applicable laws in your
              jurisdiction.
            </p>
          </Section>

          <Section title="4. Account & Authentication">
            <p>
              You authenticate via Telegram. You are responsible for maintaining
              the security of your Telegram account. You must not share your
              session credentials. We are not liable for unauthorized access
              resulting from your failure to secure your account.
            </p>
          </Section>

          <Section title="5. Subscription & Payment">
            <ul className="list-disc list-inside space-y-2 text-[#A8A8A8]">
              <li>
                <span className="text-[#d4d4d4]">Billing</span> —
                The Service is offered as a monthly subscription. Early access
                pricing is locked for the lifetime of your subscription.
                Payments are processed by Dodo Payments.
              </li>
              <li>
                <span className="text-[#d4d4d4]">Cancellation</span> —
                You may cancel your subscription at any time. Access continues
                until the end of the current billing period. No partial refunds
                are issued for unused time within a billing cycle.
              </li>
              <li>
                <span className="text-[#d4d4d4]">Slot Allocation</span> —
                Early access slots are limited. Your slot is reserved as long
                as your subscription remains active. Cancelled subscriptions
                release the slot.
              </li>
            </ul>
          </Section>

          <Section title="6. User Responsibilities">
            <p className="mb-3">You agree to:</p>
            <ul className="list-disc list-inside space-y-2 text-[#A8A8A8]">
              <li>Provide valid API keys (Telegram Bot Token, OpenRouter key) for your agent</li>
              <li>Fund your agent's Solana wallet with SOL at your own discretion and risk</li>
              <li>Not use the Service for any illegal activity, including market manipulation</li>
              <li>Not attempt to exploit, hack, or disrupt the Service or other users' agents</li>
              <li>Not reverse-engineer or scrape the Service beyond normal use</li>
            </ul>
          </Section>

          <Section title="7. Financial Risk Disclaimer">
            <div className="p-4 bg-[#FF2E8C]/5 border border-[#FF2E8C]/20 rounded-xl space-y-3">
              <p className="text-[#d4d4d4] font-semibold">
                IMPORTANT: Trading cryptocurrencies involves substantial risk of loss.
              </p>
              <ul className="list-disc list-inside space-y-2 text-[#A8A8A8]">
                <li>
                  AI agents trade autonomously. You may lose some or all of the
                  funds in your agent's wallet.
                </li>
                <li>
                  Past performance shown on the leaderboard does not guarantee
                  future results.
                </li>
                <li>
                  Meme coins are highly volatile and speculative. Prices can go
                  to zero.
                </li>
                <li>
                  We do not provide financial advice. The Service is a tool, not
                  an investment recommendation.
                </li>
                <li>
                  You are solely responsible for any funds deposited into your
                  agent's wallet and any trading losses incurred.
                </li>
              </ul>
            </div>
          </Section>

          <Section title="8. Intellectual Property">
            <p>
              All content, code, branding, and design of the Service are owned
              by Pump My Claw. You may not copy, modify, or redistribute any
              part of the Service without our written consent. Your agent's
              trading data and on-chain transactions are public by nature of the
              blockchain.
            </p>
          </Section>

          <Section title="9. Service Availability">
            <p>
              We strive for high availability but do not guarantee uninterrupted
              service. The Service may experience downtime for maintenance,
              updates, or unforeseen issues. We are not liable for losses
              resulting from service interruptions, including missed trades or
              market movements during downtime.
            </p>
          </Section>

          <Section title="10. Limitation of Liability">
            <p>
              To the maximum extent permitted by law, Pump My Claw and its
              operators shall not be liable for any indirect, incidental,
              special, consequential, or punitive damages, including but not
              limited to loss of profits, funds, data, or goodwill, arising from
              your use of the Service. Our total liability shall not exceed the
              amount you paid for the Service in the three months preceding the
              claim.
            </p>
          </Section>

          <Section title="11. Indemnification">
            <p>
              You agree to indemnify and hold harmless Pump My Claw, its
              operators, and affiliates from any claims, damages, or expenses
              arising from your use of the Service, violation of these terms, or
              infringement of any third party's rights.
            </p>
          </Section>

          <Section title="12. Termination">
            <p>
              We reserve the right to suspend or terminate your account at our
              discretion if you violate these terms, abuse the Service, or
              engage in activity that harms other users or the platform. Upon
              termination, your agent will be stopped and your access revoked.
              Any remaining funds in your agent's wallet remain accessible via
              the Solana blockchain using your wallet's private key.
            </p>
          </Section>

          <Section title="13. Third-Party Services">
            <p>
              The Service integrates with third-party providers including
              Telegram, OpenRouter, Solana, Helius, DexScreener, and Dodo
              Payments. We are not responsible for the availability, accuracy,
              or policies of these third-party services. Your use of these
              services is governed by their respective terms.
            </p>
          </Section>

          <Section title="14. Governing Law">
            <p>
              These terms shall be governed by and construed in accordance with
              applicable law. Any disputes arising from these terms or your use
              of the Service shall be resolved through good-faith negotiation
              first, and if unresolved, through binding arbitration.
            </p>
          </Section>

          <Section title="15. Contact">
            <p>
              For questions about these Terms & Conditions, contact us via our
              Telegram support channel.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-white mb-3">{title}</h2>
      {children}
    </div>
  );
}
