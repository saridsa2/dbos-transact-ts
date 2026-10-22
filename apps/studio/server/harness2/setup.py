"""Install exactly Harness2's supported OpenCode/Bun versions through upstream installers."""
from paths import configure
from harness2 import install
config = configure()
install.clone('opencode')
install.patch('opencode')
install.run(['npm', 'install', '--prefix', config.DEPENDENCIES / 'tools', 'bun@1.3.11'])
install.run([config.BUN, 'install', '--frozen-lockfile', '--ignore-scripts'], cwd=config.OPENCODE_DIR)
