#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <linux/uinput.h>

int main() {
    int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (fd < 0) {
        perror("open /dev/uinput");
        return 1;
    }

    if (ioctl(fd, UI_SET_EVBIT, EV_KEY) ||
        ioctl(fd, UI_SET_EVBIT, EV_REL) ||
        ioctl(fd, UI_SET_EVBIT, EV_SYN)) {
        perror("UI_SET_EVBIT");
        return 1;
    }

    for (int i = 0; i < 256; i++) {
        ioctl(fd, UI_SET_KEYBIT, i);
    }
    ioctl(fd, UI_SET_KEYBIT, BTN_LEFT);
    ioctl(fd, UI_SET_KEYBIT, BTN_RIGHT);
    ioctl(fd, UI_SET_KEYBIT, BTN_MIDDLE);

    ioctl(fd, UI_SET_RELBIT, REL_X);
    ioctl(fd, UI_SET_RELBIT, REL_Y);
    ioctl(fd, UI_SET_RELBIT, REL_WHEEL);
    ioctl(fd, UI_SET_RELBIT, REL_HWHEEL);

    struct uinput_setup usetup = {
        .name = "omarchy-touchpad",
        .id = {
            .bustype = BUS_VIRTUAL,
            .vendor = 0x1234,
            .product = 0x5678,
            .version = 1
        }
    };

    if (ioctl(fd, UI_DEV_SETUP, &usetup)) {
        perror("UI_DEV_SETUP");
        return 1;
    }

    if (ioctl(fd, UI_DEV_CREATE)) {
        perror("UI_DEV_CREATE");
        return 1;
    }

    usleep(200000);
    fflush(stdout);
    printf("uinput device ready\n");

    struct input_event ev;
    while (read(STDIN_FILENO, &ev, sizeof(ev)) == sizeof(ev)) {
        if (write(fd, &ev, sizeof(ev)) != sizeof(ev)) {
            perror("write");
            break;
        }
    }

    ioctl(fd, UI_DEV_DESTROY);
    close(fd);
    return 0;
}
