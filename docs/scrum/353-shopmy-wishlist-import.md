# Scrum 353 - ShopMy Wishlist Import

## Status

On hold as of 2026-08-06.

The live integration is blocked by ShopMy partner approval, API credentials, and confirmation that its OAuth API can return shopper Wishlists and their products.

## Initial Ticket Requirement

> Integrate with ShopMy so that items users have already put in their ShopMy accounts can easily be added to their myuse closets and packing lists.

## Confirmed MVP Scope

- The ShopMy users are shoppers, not creators.
- "Items" means products saved in ShopMy Wishlists/Lists.
- Users connect their ShopMy accounts through OAuth.
- Users choose one or multiple Wishlist products to import.
- Products may be added to the myuse closet, a selected packing list, or both.
- Adding a product to a packing list must also create or link its closet item.
- Imports are user-triggered snapshots, not automatic ongoing synchronization.
- Users can manually refresh ShopMy in myuse to find newly saved products.
- ShopMy changes or removals must not automatically update or delete existing myuse items.
- Existing closet items should be reused instead of duplicated.

## User Story

As a myuse user with a ShopMy shopper account, I want to connect ShopMy, select products I previously saved in a Wishlist, and import them into my closet or packing list so that I do not have to recreate each item manually.

## Intended User Flow

1. The user selects **Connect ShopMy** in myuse.
2. myuse opens ShopMy's OAuth authorization page.
3. The user signs in directly on ShopMy and grants read access.
4. ShopMy redirects to a registered myuse backend callback.
5. The myuse backend exchanges the authorization code for a user access token.
6. myuse retrieves the user's ShopMy Wishlists and products.
7. The user opens a Wishlist and selects one or multiple products.
8. The user chooses a destination:
   - Closet
   - A selected packing list
   - Both
9. myuse asks whether the user owns each selected product and requests missing optional details such as size or color.
10. myuse creates or reuses a closet item.
11. If a packing list was selected, myuse adds the closet item to that packing list.
12. A later **Refresh from ShopMy** action retrieves newly saved products without changing previously imported items.

## Manual ShopMy Findings

The supplied test account was reviewed through ShopMy's shopper interface.

- The account is a shopper account; its menu includes **Apply for Creator Account**.
- Shopper areas include **My Orders**, **My Wishlists**, and **My Gifts**.
- My Orders can contain orders placed through ShopMy links or synchronized from Gmail and Plaid.
- The supplied account initially had no Orders, Wishlist products, or Gifts.
- Three test products were manually added to **My Wishlist**.
- ShopMy presents a Wishlist as a collection:
  - Collection name: `My Wishlist`
  - Observed collection ID: `6841770`
  - Observed URL format: `/shop/collections/{collectionId}`
- An observed product used:
  - ShopMy product ID: `516806`
  - Observed URL format: `/shop/product/{productId}`
  - Brand: Alexander Wang
  - Category: Blazers
  - Name: Tailored Blazer
  - Current price: $438
  - Retailer: FWRD
  - Stock: Out of stock
- Product pages expose an image, brand, category, name, descriptions, current price, retailer, availability, Wishlist status, and buying options.
- Product pages do not establish ownership or expose the user's selected size, color, purchase date, or actual purchase price.
- Current price and stock are catalog information, not proof of purchase.

The fact that the shopper Wishlist is displayed as a collection is encouraging, but it does not prove that the documented partner `read_collections` scope exposes shopper Wishlists or product membership.

## Proposed Data Mapping

| ShopMy data | myuse use |
| --- | --- |
| Product ID | External source ID and duplicate detection |
| Collection ID | Source Wishlist reference |
| Name | Closet item name |
| Brand | Closet item brand |
| Category | Input to myuse category mapping |
| Image | Closet item image |
| Description | Optional item description |
| Current price | Optional reference price, not purchase price |
| Retailer | Source retailer |
| Product/retailer URL | Source link |
| Stock status | Optional reference status |
| Source | `shopmy` |

The user must provide or confirm ownership, size, and color when needed.

## Integration Blockers

### 1. Private partner API access

ShopMy's developer API is not publicly self-service. A normal shopper or creator account does not provide API credentials, and becoming a creator does not grant an API key.

myuse needs ShopMy to provide:

- External partner approval
- Partner developer key
- Developer ID
- Registration of myuse OAuth callback URLs
- Applicable partnership, privacy, and data-processing requirements

The developer key must remain on the myuse server and must never be included in the mobile app, frontend bundle, or repository.

### 2. Shopper Wishlist API confirmation

ShopMy's public OAuth documentation lists scopes such as `read_collections`, `read_links`, and `read_profile`. It does not explicitly document a shopper Wishlist scope.

ShopMy must confirm:

- Whether `read_collections` returns shopper Lists/Wishlists
- Whether it returns or can retrieve all products belonging to each Wishlist
- Which endpoint returns complete product details and buying options
- Which read-only scopes myuse should request

### 3. No public sandbox for this use case

ShopMy documents a sandbox for Brand Partners, but it requires a ShopMy-issued sandbox token and is not a public sandbox for shopper OAuth/Wishlist integrations.

myuse needs either:

- An external-developer OAuth sandbox with test credentials, or
- Approved production-like test credentials and a seeded shopper account

## Required Action From Management

1. Approve the confirmed Wishlist-only MVP scope in writing.
2. Assign a myuse business contact and technical contact for ShopMy onboarding.
3. Contact `partners@shopmyshelf.us` from an official myuse company email.
4. Request partner approval, credentials, Wishlist access, product-detail access, and a test environment.
5. Coordinate with engineering to provide development, staging, and production HTTPS callback URLs for ShopMy to register.
6. Complete any ShopMy commercial, legal, privacy, security, or application-review requirements.
7. Forward ShopMy's API documentation, credentials-handling requirements, and technical response to engineering.

If the partner team does not respond, management can copy `brandsupport@shopmy.us` and ask that the request be routed to the API partnerships team.

## Suggested ShopMy Request

**To:** `partners@shopmyshelf.us`  
**Subject:** `myuse x ShopMy - Partner API and OAuth Access Request`

> Hi ShopMy team,
>
> myuse is building an integration that allows authenticated ShopMy shoppers to select products from their Wishlists and import them into myuse closets and packing lists.
>
> We would like to request:
>
> - External partner API approval
> - A developer key and Developer ID
> - Registration of our OAuth callback URLs
> - Confirmation that `read_collections` includes shopper Lists/Wishlists and their products
> - If not, access to the appropriate shopper Wishlist scope and endpoint
> - Product-detail access, including product ID, name, image, brand, category, description, retailer URL, current price, and availability
> - An external-developer OAuth sandbox or seeded test account
> - Documentation for pagination, rate limits, token lifetime, revocation, errors, and applicable partnership requirements
>
> Please let us know the onboarding requirements and any applicable partnership terms.
>
> Thank you.

## Resume Conditions

Resume live implementation only after ShopMy provides or confirms all of the following:

- myuse is approved as an external partner.
- A developer key and Developer ID are available through an approved secure channel.
- OAuth callback URLs are registered.
- Shopper Wishlist access and product membership are supported.
- Required product fields are available through supported APIs.
- A test environment or approved seeded account is available.
- Applicable legal and security requirements are understood and accepted.

Engineering may prepare mock UI, internal interfaces, and data models before these conditions are met, but the live OAuth connection and API behavior cannot be implemented or verified.

## Initial Acceptance Criteria After Unblocking

- A shopper can connect ShopMy without giving myuse their ShopMy password.
- myuse retrieves the shopper's supported Wishlists and products through approved ShopMy APIs.
- The shopper can select one or multiple products.
- The shopper can add selected products to the closet, a packing list, or both.
- Adding directly to a packing list also creates or reuses the corresponding closet item.
- Re-importing the same ShopMy product does not create a duplicate closet item.
- Missing size, color, and ownership information can be supplied or confirmed by the user.
- Manual refresh shows newly saved ShopMy products.
- Removing or changing a product in ShopMy does not delete or silently overwrite an imported myuse item.
- OAuth tokens and the partner developer key are handled only by the server and stored securely.
- The user can disconnect ShopMy and myuse stops using the associated access token.

## Out of Scope for the Initial Version

- ShopMy Orders
- ShopMy Gifts
- Creator product Links and storefront Collections
- Publishing or editing ShopMy data from myuse
- Affiliate or commission tracking
- Purchasing or checkout
- Automatic background synchronization
- Automatically deleting myuse items when they are removed from ShopMy
- Scraping ShopMy pages or using undocumented authenticated endpoints

## Official References

- ShopMy OAuth setup: https://docs.shopmy.us/reference/getting-started-with-your-api-1
- Fetch collections: https://docs.shopmy.us/reference/fetch-collections
- Fetch links: https://docs.shopmy.us/reference/fetch-links
- Brand Partner sandbox: https://docs.shopmy.us/reference/getting-started-with-sandbox-api
- ShopMy contact page: https://shopmy.us/contact

## Manual Review Evidence

The following local screenshots were reviewed during discovery:

- `/mnt/c/Users/Jay Termulo/OneDrive/Pictures/Screenshots/Screenshot 2026-08-06 092303.png`
- `/mnt/c/Users/Jay Termulo/OneDrive/Pictures/Screenshots/Screenshot 2026-08-06 092434.png`
- `/mnt/c/Users/Jay Termulo/OneDrive/Pictures/Screenshots/Screenshot 2026-08-06 092620.png`
- `/mnt/c/Users/Jay Termulo/OneDrive/Pictures/Screenshots/Screenshot 2026-08-06 094026.png`
- `/mnt/c/Users/Jay Termulo/OneDrive/Pictures/Screenshots/Screenshot 2026-08-06 094050.png`
- `/mnt/c/Users/Jay Termulo/OneDrive/Pictures/Screenshots/Screenshot 2026-08-06 094120.png`
- `/mnt/c/Users/Jay Termulo/OneDrive/Pictures/Screenshots/Screenshot 2026-08-06 094439.png`
- `/mnt/c/Users/Jay Termulo/OneDrive/Pictures/Screenshots/Screenshot 2026-08-06 094537.png`
- `/mnt/c/Users/Jay Termulo/OneDrive/Pictures/Screenshots/Screenshot 2026-08-06 094849.png`
- `/mnt/c/Users/Jay Termulo/OneDrive/Pictures/Screenshots/Screenshot 2026-08-06 095157.png`
- `/mnt/c/Users/Jay Termulo/OneDrive/Pictures/Screenshots/Screenshot 2026-08-06 095405.png`
