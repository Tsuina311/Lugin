import { ExternalLink } from './icons';
import { IconButton } from './IconButton';

import { sellerBrowseStore } from '@/content/sellerBrowseStore';
import { sellerStockUrls } from '@/sites/cardmarket/wants';

/** Click a seller name to browse their singles stock in the Search tab list UI. */
export const SellerNameButton = ({
  className = 'truncate font-medium text-accent hover:underline',
  name,
  url,
  wantListId,
}: {
  className?: string;
  name: string;
  /** Profile or offers URL when known. */
  url?: string | null;
  /** Prefer Cardmarket’s want-list filter when opening from Best Sellers. */
  wantListId?: string | null;
}) => {
  const profile = sellerStockUrls(name, url)?.profile;

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-0.5">
      <button
        className={`min-w-0 ${className}`}
        onClick={e => {
          e.stopPropagation();
          e.preventDefault();
          sellerBrowseStore.request(name, url ?? undefined, undefined, wantListId ?? undefined);
        }}
        title={
          wantListId
            ? `Browse ${name}'s stock for this want list in Lugin`
            : `Browse ${name}'s stock in Lugin`
        }
        type="button"
      >
        {name}
      </button>
      {profile ? (
        <IconButton
          className="flex-none opacity-60 hover:opacity-100"
          icon={ExternalLink}
          label={`Open ${name} on Cardmarket`}
          onClick={e => {
            e.stopPropagation();
            const href = wantListId
              ? `${profile.replace(/\/?$/, '')}/Offers/Singles?idWantslist=${encodeURIComponent(wantListId)}`
              : profile;
            window.open(href, '_blank', 'noopener,noreferrer');
          }}
          size="xs"
          tone="default"
        />
      ) : null}
    </span>
  );
};
