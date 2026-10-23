"""Use the same installed font file in the browser and libass."""
import os
from pathlib import Path
from config import BASE_DIR

FONT_PATHS = {
    "Roboto": [Path('/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Bold.ttf'),
               Path('/usr/share/fonts/truetype/roboto/Roboto-Bold.ttf')],
    "Arial": [BASE_DIR / 'font.ttf'],
    "Liberation Sans": [Path('/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'),
                        Path('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf')],
}
windows_fonts = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
FONT_PATHS['Roboto'].append(windows_fonts / 'Roboto-Bold.ttf')
FONT_PATHS['Arial'].append(windows_fonts / 'arialbd.ttf')
FONT_PATHS['Liberation Sans'].append(windows_fonts / 'LiberationSans-Bold.ttf')


def resolve_font(name):
    if name not in FONT_PATHS:
        raise ValueError('Unsupported font')
    for path in FONT_PATHS[name]:
        if path.is_file():
            return name, path
    return 'Arial', BASE_DIR / 'font.ttf'
