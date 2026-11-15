#include <stdio.h>

/* Tinh tong cac so tu 1 den n */
static long sum_to(int n)
{
    long total = 0;
    for (int i = 1; i <= n; i++) {
        total += i;
    }
    return total;
}

int main(void)
{
    int n = 10;
    printf("Hello from GSC_2026!\n");
    printf("Tong tu 1 den %d = %ld\n", n, sum_to(n));
    return 0;
}
