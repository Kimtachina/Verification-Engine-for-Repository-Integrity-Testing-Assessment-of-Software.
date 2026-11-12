# Fixture: `reconcile` nests six levels deep (cyclomatic 6, cognitive 15).
def reconcile(accounts):
    for account in accounts:
        if account.active:
            for entry in account.entries:
                if entry.amount:
                    with entry.lock:
                        if entry.pending:
                            entry.settle()
    return accounts


def ok(x):
    return x
