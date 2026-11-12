// Fixture: `priceFor` is deliberately too complex (cyclomatic 14, cognitive 30, nesting 5).
export interface Item {
  kind: string;
  qty: number;
  member?: boolean;
  coupon?: string;
}

export function priceFor(item: Item, base: number): number {
  let price = base;
  if (item.qty > 0) {
    if (item.kind === "book") {
      for (let i = 0; i < item.qty; i++) {
        if (item.member) {
          if (item.coupon && item.coupon.startsWith("VIP")) {
            price -= 2;
          } else {
            price -= 1;
          }
        }
      }
    } else if (item.kind === "food") {
      price = item.member || item.qty > 10 ? price * 0.9 : price;
    } else if (item.kind === "toy") {
      while (price > 100) {
        price -= 10;
      }
    } else {
      switch (item.coupon) {
        case "HALF":
          price /= 2;
          break;
        case "TENOFF":
          price -= 10;
          break;
      }
    }
  }
  return price;
}
