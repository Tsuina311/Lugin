import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { Button } from './Button';
import { Select } from './Field';

import { cartStore } from '@/content/cartStore';
import { askForLogin, clearCachedTokens, cmToken, rememberWriteToken } from '@/content/session';
import { shippingStore } from '@/content/shippingStore';
import { wantsStore } from '@/content/wantsStore';
import {
  findAllBeneficialOneWantMoves,
  offersMapFromLines,
  summarizeMoves,
  type ConsolidationMoveResult,
} from '@/lib/consolidation';
import { inferWantListForCart } from '@/lib/inferWantList';
import { buildPurchasePlanFromCart } from '@/lib/purchasePlan';
import { wantKeyOf } from '@/lib/sellerWantPricing';
import { addArticleToCart } from '@/sites/cardmarket/cart';
import { countryId, estimateShipping } from '@/sites/cardmarket/shipping';
import { fetchSellerListOffers, pace, sellerStockUrls } from '@/sites/cardmarket/wants';

const fmtEuro = (n: number): string => `${n.toFixed(2).replace('.', ',')} €`;

const moveKey = (m: ConsolidationMoveResult): string =>
  `${m.wantKey}|${m.fromSellerId}|${m.toSellerId}`;

/**
 * After Shopping Wizard (or any multi-seller cart): probe each cart seller’s
 * stock for the chosen want list and surface one-card moves that cut a letter.
 */
export const CartConsolidation = () => {
  const cart = useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot);
  const shipping = useSyncExternalStore(shippingStore.subscribe, shippingStore.getSnapshot);
  const wants = useSyncExternalStore(wantsStore.subscribe, wantsStore.getSnapshot);

  const inferred = useMemo(
    () => inferWantListForCart(wants.index, cart.items.map(i => i.name)),
    [wants.index, cart.items],
  );

  const listOptions = wants.index?.lists ?? [];
  const [listId, setListId] = useState('');
  useEffect(() => {
    if (listId) return;
    if (inferred?.id) setListId(inferred.id);
    else if (listOptions[0]?.id) setListId(listOptions[0].id);
  }, [inferred?.id, listId, listOptions]);

  const [status, setStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moves, setMoves] = useState<ConsolidationMoveResult[]>([]);
  const [articleByMove, setArticleByMove] = useState<Record<string, string[]>>({});
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const plan = useMemo(() => {
    const estimate = (sellerId: string, cardCount: number, goodsTotal: number) => {
      const item = cart.items.find(i => i.sellerId === sellerId);
      const fromId = countryId(item?.sellerCountry);
      const matrix = fromId != null ? shipping.matrices[fromId] : undefined;
      if (!matrix?.length || cardCount <= 0) return undefined;
      const est = estimateShipping(matrix, cardCount, goodsTotal);
      if (!est) return undefined;
      return {
        price: est.method.price,
        weight: est.weight,
        tierMaxCards: est.tierMaxCards,
        nextTierMaxCards: est.nextTierMaxCards,
        remainingWeightInTier: est.remainingWeightInTier,
        methodName: est.method.name,
      };
    };
    return buildPurchasePlanFromCart(
      cart.items.map(i => ({
        articleId: i.articleId,
        name: i.name,
        amount: i.amount,
        unitPrice: i.priceValue,
        sellerId: i.sellerId,
        sellerName: i.seller,
      })),
      estimate,
      cart.fetchedAt ?? Date.now(),
    );
  }, [cart.items, cart.fetchedAt, shipping.matrices]);

  useEffect(() => {
    setMoves([]);
    setArticleByMove({});
    setStatus('idle');
    setProgress(null);
    setError(null);
    setApplyMsg(null);
    abortRef.current?.abort();
  }, [plan.fingerprint]);

  const sellersWithId = useMemo(() => {
    const map = new Map<string, { sellerId: string; name: string; country?: string }>();
    for (const i of cart.items) {
      if (!i.sellerId || !i.seller) continue;
      if (!map.has(i.sellerId)) {
        map.set(i.sellerId, {
          sellerId: i.sellerId,
          name: i.seller,
          country: i.sellerCountry,
        });
      }
    }
    return [...map.values()];
  }, [cart.items]);

  const runScan = async () => {
    if (!listId) {
      setError('Pick a want list to probe (Cardmarket filters by idWantslist).');
      setStatus('error');
      return;
    }
    if (plan.planTrust === 'INCOMPLETE' || plan.sellers.length < 2) {
      setError(
        'Need at least two cart sellers with known ids — run Shopping Wizard → Add all first.',
      );
      setStatus('error');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('scanning');
    setError(null);
    setApplyMsg(null);
    setMoves([]);
    setArticleByMove({});

    for (const s of sellersWithId) {
      const id = countryId(s.country);
      if (id != null) void shippingStore.ensureMatrix(id);
    }

    const offersBySeller = new Map<
      string,
      Map<string, { unitPrice: number; articleIds: string[]; maxQty: number }>
    >();

    try {
      for (let i = 0; i < sellersWithId.length; i++) {
        if (controller.signal.aborted) return;
        const s = sellersWithId[i];
        setProgress(`Probing ${s.name} (${i + 1}/${sellersWithId.length})…`);
        const urls = sellerStockUrls(s.name);
        if (!urls) continue;
        if (i > 0) await pace(controller.signal);
        const { offers } = await fetchSellerListOffers(
          urls.profile,
          listId,
          () => {},
          controller.signal,
        );
        const lines = offers
          .filter(o => o.priceValue != null && Number.isFinite(o.priceValue))
          .map(o => ({
            wantKey: wantKeyOf(o.name),
            unitPrice: o.priceValue!,
            articleId: o.articleId,
            quantity: Math.max(1, o.quantity ?? 1),
          }));
        offersBySeller.set(s.sellerId, offersMapFromLines(lines));
      }

      const estimateShip = (sellerId: string, cardCount: number, goodsTotal: number) => {
        const item = cart.items.find(ci => ci.sellerId === sellerId);
        const fromId = countryId(item?.sellerCountry);
        const matrix = fromId != null ? shipping.matrices[fromId] : undefined;
        if (!matrix?.length || cardCount <= 0) return 0;
        return estimateShipping(matrix, cardCount, goodsTotal)?.method.price ?? 0;
      };

      const found = findAllBeneficialOneWantMoves({
        plan,
        offersBySeller,
        estimateShip,
      });

      const articles: Record<string, string[]> = {};
      for (const m of found) {
        const pool = offersBySeller.get(m.toSellerId)?.get(m.wantKey);
        articles[moveKey(m)] = pool?.articleIds.slice(0, m.quantityMoved) ?? [];
      }

      setArticleByMove(articles);
      setMoves(found);
      setStatus('done');
      setProgress(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    }
  };

  const applyMove = async (move: ConsolidationMoveResult) => {
    const ids = articleByMove[moveKey(move)] ?? [];
    if (ids.length === 0) {
      setApplyMsg('No article ids for that move — re-scan and try again.');
      return;
    }
    setApplyMsg(null);
    try {
      let added = 0;
      for (const articleId of ids) {
        const attempt = async () => {
          const token = await cmToken();
          if (!token) return { message: 'Not signed in', ok: false as const };
          rememberWriteToken(token);
          return addArticleToCart(articleId, token);
        };
        let r = await attempt();
        if (!r.ok && /could not be completed|session|token|csrf|sign in/i.test(r.message)) {
          clearCachedTokens();
          r = await attempt();
        }
        if (!r.ok && /not signed in/i.test(r.message)) {
          askForLogin();
          throw new Error(r.message);
        }
        if (r.ok) added++;
        await new Promise(done => setTimeout(done, 350 + Math.random() * 350));
      }
      await cartStore.refresh();
      setApplyMsg(
        added > 0
          ? `Added ${added} replacement cop${added === 1 ? 'y' : 'ies'}. Remove the old line(s) from the other seller on Cardmarket.`
          : 'Cardmarket refused the add.',
      );
    } catch (err) {
      setApplyMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const summary = summarizeMoves(moves);
  const canScan = cart.items.length > 0 && sellersWithId.length >= 2;

  return (
    <div className="border-b border-line px-2 py-1.5 text-2xs">
      <div className="mb-1 font-medium text-ink">Cut letters from this cart</div>
      <p className="mb-1.5 text-ink-muted">
        Uses your cart as the plan (e.g. after Shopping Wizard). Probes each seller for other
        wants on the list and only recommends moves that save delivered € — usually by removing a
        shipment.
      </p>

      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {listOptions.length > 0 ? (
          <Select
            className="max-w-[12rem]"
            onChange={e => setListId(e.target.value)}
            title="Want list used for Cardmarket stock filter"
            value={listId}
          >
            {listOptions.map(l => (
              <option key={l.id} value={l.id}>
                {l.name}
                {inferred?.id === l.id ? ' · best match' : ''}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-warn">Sync want lists first (Wants tab).</span>
        )}
        <Button
          disabled={!canScan || status === 'scanning' || !listId}
          onClick={() => void runScan()}
          size="xs"
          variant="neutral"
        >
          {status === 'scanning' ? 'Scanning…' : 'Find letter cuts'}
        </Button>
        {status === 'scanning' && (
          <Button onClick={() => abortRef.current?.abort()} size="xs" variant="subtle">
            Stop
          </Button>
        )}
      </div>

      {progress && <p className="text-ink-faint">{progress}</p>}
      {error && <p className="text-neg">{error}</p>}
      {applyMsg && <p className="text-warn">{applyMsg}</p>}

      {status === 'done' && moves.length === 0 && (
        <p className="text-ink-muted">
          No proven letter-cutting moves on this plan. Sellers may not stock each other’s cards
          cheaply enough to beat shipping.
        </p>
      )}

      {summary.count > 0 && (
        <div className="mb-1 text-ink-muted">
          {summary.count} opportunit{summary.count === 1 ? 'y' : 'ies'}
          {summary.estSave > 0 && <> · Est. save ~{fmtEuro(summary.estSave)}</>}
          {summary.sellersRemovable > 0 && (
            <>
              {' '}
              · Could remove {summary.sellersRemovable} shipment
              {summary.sellersRemovable === 1 ? '' : 's'}
            </>
          )}
        </div>
      )}

      <ul className="max-h-56 space-y-1.5 overflow-y-auto overscroll-contain">
        {moves.map(m => (
          <li key={moveKey(m)} className="rounded border border-pos/30 bg-pos/5 px-1.5 py-1">
            <div className="font-medium text-pos">
              {m.sourceSellerRemoved ? 'Remove a letter' : 'Tier / goods tweak'} · save ~
              {fmtEuro(-m.netDelta)}
            </div>
            {m.explanation.map((line, i) => (
              <div key={i} className="text-ink-muted">
                {line}
              </div>
            ))}
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Button onClick={() => void applyMove(m)} size="xs" variant="success">
                Use other seller
              </Button>
              <span className="text-ink-faint">
                Adds the replacement — remove the old copy from the other seller on Cardmarket.
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
