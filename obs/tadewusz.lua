-- Tadewusz для OBS: запускае праграму разам з OBS і дадае крыніцу «Tadewusz · Галасаванне».
-- Уся логіка жыве ў ядры (core/main.js); скрыпт толькі запускае яго і малюе старонку оверлея.
local obs = obslua
local bit = require('bit')

local function script_dir()
    return (script_path():gsub('\\', '/'))
end

-- Крыніца-абгортка над браўзерам: шрыфт і колер задаюцца ўласцівасцямі OBS.
-- Ідэнтыфікатар застаўся ад ранейшай версіі, каб існуючыя сцэны не страцілі крыніцу.
local source = {
    id = 'obs_bot_overlay_v1',
    type = obs.OBS_SOURCE_TYPE_INPUT,
    output_flags = bit.bor(obs.OBS_SOURCE_VIDEO, obs.OBS_SOURCE_CUSTOM_DRAW),
}

source.get_name = function() return 'Tadewusz · Галасаванне' end

local function css_quote(text)
    return (tostring(text):gsub('[\\"\r\n]', ''))
end

local function browser_settings(settings)
    local browser = obs.obs_data_create()
    -- Старонка чакання: оверлей з'явіцца, як толькі запусціцца ядро.
    obs.obs_data_set_string(browser, 'url', 'file:///' .. script_dir() .. 'start.html?page=overlay')
    obs.obs_data_set_int(browser, 'width', obs.obs_data_get_int(settings, 'width'))
    obs.obs_data_set_int(browser, 'height', obs.obs_data_get_int(settings, 'height'))
    obs.obs_data_set_bool(browser, 'shutdown', false)
    local font = obs.obs_data_get_obj(settings, 'font')
    local face, size, flags = 'Segoe UI', 32, 0
    if font ~= nil then
        face = obs.obs_data_get_string(font, 'face')
        size = obs.obs_data_get_int(font, 'size')
        flags = obs.obs_data_get_int(font, 'flags')
        obs.obs_data_release(font)
    end
    local color = obs.obs_data_get_int(settings, 'color')
    local rgb = string.format('#%02x%02x%02x', bit.band(color, 255), bit.band(bit.rshift(color, 8), 255), bit.band(bit.rshift(color, 16), 255))
    local weight = bit.band(flags, 1) ~= 0 and '700' or '400'
    local style = bit.band(flags, 2) ~= 0 and 'italic' or 'normal'
    obs.obs_data_set_string(browser, 'css', string.format(
        'html,body{background:transparent!important}body{font-family:"%s"!important;font-size:%dpx!important;font-weight:%s!important;font-style:%s!important;color:%s!important}',
        css_quote(face), math.max(8, size), weight, style, rgb))
    return browser
end

source.get_defaults = function(settings)
    obs.obs_data_set_default_int(settings, 'width', 1920)
    obs.obs_data_set_default_int(settings, 'height', 1080)
    obs.obs_data_set_default_int(settings, 'color', 0xffffff)
    local font = obs.obs_data_create()
    obs.obs_data_set_string(font, 'face', 'Segoe UI')
    obs.obs_data_set_int(font, 'size', 32)
    obs.obs_data_set_int(font, 'flags', 0)
    obs.obs_data_set_default_obj(settings, 'font', font)
    obs.obs_data_release(font)
end

source.get_properties = function()
    local props = obs.obs_properties_create()
    obs.obs_properties_add_font(props, 'font', 'Шрыфт')
    obs.obs_properties_add_color(props, 'color', 'Колер тэксту')
    obs.obs_properties_add_int(props, 'width', 'Шырыня кадра', 320, 7680, 1)
    obs.obs_properties_add_int(props, 'height', 'Вышыня кадра', 240, 4320, 1)
    return props
end

source.create = function(settings)
    local data = { width = obs.obs_data_get_int(settings, 'width'), height = obs.obs_data_get_int(settings, 'height') }
    local browser = browser_settings(settings)
    data.browser = obs.obs_source_create_private('browser_source', 'Tadewusz renderer', browser)
    obs.obs_data_release(browser)
    if data.browser ~= nil then
        -- Старонка жыве ўвесь час, нават калі крыніца не бачная (абвесткі не губляюцца).
        obs.obs_source_inc_active(data.browser)
        obs.obs_source_inc_showing(data.browser)
    end
    return data
end

source.update = function(data, settings)
    data.width = obs.obs_data_get_int(settings, 'width')
    data.height = obs.obs_data_get_int(settings, 'height')
    if data.browser ~= nil then
        local browser = browser_settings(settings)
        obs.obs_source_update(data.browser, browser)
        obs.obs_data_release(browser)
    end
end

source.video_render = function(data)
    if data.browser ~= nil then obs.obs_source_video_render(data.browser) end
end
source.get_width = function(data) return data.width end
source.get_height = function(data) return data.height end

source.destroy = function(data)
    if data.browser ~= nil then
        obs.obs_source_dec_showing(data.browser)
        obs.obs_source_dec_active(data.browser)
        obs.obs_source_release(data.browser)
    end
end

function script_description()
    return 'Tadewusz: галасаванне, бягучы радок і музыка. Праграма запускаецца разам з OBS; док — http://127.0.0.1:18745'
end

-- Запуск ядра разам з OBS. Перазагрузка скрыпта ядро не спыняе: яно завершыцца само, калі закрыецца OBS.
function script_load()
    local launcher = script_dir() .. 'launch.vbs'
    if launcher:find('["\r\n]') then
        obs.script_log(obs.LOG_ERROR, 'tadewusz: недапушчальны шлях да launch.vbs')
        return
    end
    local ffi = require('ffi')
    pcall(ffi.cdef, 'unsigned long GetCurrentProcessId(void);')
    local pid = tonumber(ffi.C.GetCurrentProcessId())
    os.execute('start "" /b wscript.exe "' .. launcher:gsub('/', '\\') .. '" ' .. pid)
end

obs.obs_register_source(source)
