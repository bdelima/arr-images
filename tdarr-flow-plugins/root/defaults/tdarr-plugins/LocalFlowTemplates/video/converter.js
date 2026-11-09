'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Exported verbatim from the live Tdarr flow "264 to 265 Converter" (originally _id YEZ9GlGHp, now 20ZN6oc41) on 2026-11-08.
// details() carries the flow's own _id (the first field below), because the goToFlow nodes in the other flows point at
// it by id. Whether Tdarr keeps an _id given here when a flow is created from this file (Add Flow > Local) is unverified;
// to update a live flow in place, paste its JSON, with the same _id, into Import JSON Flow Template and choose Replace.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "20ZN6oc41",
    "name": "264 to 265 Converter",
    "description": "264 to 265 Converter",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Entry from Controller Flow",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "X4ANCc9vI",
        "position": {
          "x": 456,
          "y": 192
        }
      },
      {
        "name": "Remove video streams",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandRemoveStreamByProperty",
        "version": "1.0.0",
        "inputsDB": {
          "codecType": "video",
          "propertyToCheck": "codec_type",
          "valuesToRemove": "video",
          "condition": "equals"
        },
        "fpEnabled": true,
        "id": "RlgLKOmxg",
        "position": {
          "x": 456,
          "y": 252
        }
      },
      {
        "name": "Execute (audio+subs only)",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandExecute",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "JTeKdNnFR",
        "position": {
          "x": 456,
          "y": 300
        }
      },
      {
        "name": "Preserve audio+subs (stable path)",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "true",
          "userCli": "mkvmerge",
          "customCliPath": "/bin/sh",
          "doesCommandCreateOutputFile": "true",
          "userOutputFilePath": "/downloads/.tdarr-remux-cache/{{{args.originalLibraryFile.fileNameWithoutExtension}}}-audiosubs.mkv",
          "cliArguments": "-c mkdir -p \"/downloads/.tdarr-remux-cache\"; cp \"{{{args.inputFileObj._id}}}\" \"${outputFilePath}\"",
          "outputFileBecomesWorkingFile": "false"
        },
        "fpEnabled": true,
        "id": "IBXuDL7Dx",
        "position": {
          "x": 456,
          "y": 348
        }
      },
      {
        "name": "Extract video from original",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "false",
          "userCli": "ffmpeg",
          "customCliPath": "/usr/bin/mkvmerge",
          "doesCommandCreateOutputFile": "true",
          "userOutputFilePath": "${cacheDir}/${fileName}-video.mkv",
          "cliArguments": "-y -i \"{{{args.originalLibraryFile._id}}}\" -map 0:v:0 -c:v copy -an -sn \"${outputFilePath}\"",
          "outputFileBecomesWorkingFile": "true"
        },
        "fpEnabled": true,
        "id": "tpYlSXpfK",
        "position": {
          "x": 456,
          "y": 396
        }
      },
      {
        "name": "Tags: Requeue to Encoder",
        "sourceRepo": "Community",
        "pluginName": "tagsRequeue",
        "version": "1.0.0",
        "inputsDB": {
          "useBasicQueueTags": "false",
          "basicQueueTags": "requireCPU",
          "customQueueTags": "requireGPU,encoder"
        },
        "fpEnabled": true,
        "id": "tHF4vUCsM",
        "position": {
          "x": 456,
          "y": 432
        }
      },
      {
        "name": "Begin Command (encode)",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandStart",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "ehGAkWvj7",
        "position": {
          "x": 456,
          "y": 468
        }
      },
      {
        "name": "Set Video Encoder",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandSetVideoEncoder",
        "version": "1.0.0",
        "inputsDB": {
          "outputCodec": "hevc",
          "ffmpegPresetEnabled": "true",
          "ffmpegPreset": "slow",
          "ffmpegQualityEnabled": "true",
          "ffmpegQuality": "18",
          "hardwareEncoding": "true",
          "hardwareType": "qsv",
          "hardwareDecoding": "true",
          "forceEncoding": "true"
        },
        "fpEnabled": true,
        "id": "FAc9QeWJK",
        "position": {
          "x": 456,
          "y": 516
        }
      },
      {
        "name": "Set Source-Relative Bitrate",
        "sourceRepo": "Local",
        "pluginName": "setSourceRelativeBitrate",
        "version": "1.0.0",
        "inputsDB": {
          "enabled": "true",
          "targetPercent": "70",
          "ceilingPercent": "100",
          "bufsizeMultiplier": "2",
          "minTargetKbps": "300",
          "assumedAudioKbps": "256"
        },
        "fpEnabled": true,
        "id": "srcRelCap",
        "position": {
          "x": 456,
          "y": 540
        }
      },
      {
        "name": "Tag Encode Settings",
        "sourceRepo": "Local",
        "pluginName": "tagEncodeSettings",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "d7QK1TBlh",
        "position": {
          "x": 456,
          "y": 564
        }
      },
      {
        "name": "Execute (encode)",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandExecute",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "Y40uvSwMF",
        "position": {
          "x": 456,
          "y": 600
        }
      },
      {
        "name": "Tags: Requeue to local (demux path)",
        "sourceRepo": "Community",
        "pluginName": "tagsRequeue",
        "version": "1.0.0",
        "inputsDB": {
          "useBasicQueueTags": "false",
          "customQueueTags": "requireCPU,local"
        },
        "fpEnabled": true,
        "id": "LZDe1f8rE",
        "position": {
          "x": 456,
          "y": 648
        }
      },
      {
        "name": "Final remux",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "false",
          "userCli": "ffmpeg",
          "customCliPath": "/usr/bin/mkvmerge",
          "doesCommandCreateOutputFile": "true",
          "userOutputFilePath": "${cacheDir}/${fileName}-final.mkv",
          "cliArguments": "-y -i \"{{{args.inputFileObj._id}}}\" -i \"/downloads/.tdarr-remux-cache/{{{args.originalLibraryFile.fileNameWithoutExtension}}}-audiosubs.mkv\" -map 0:v:0 -map 1 -c copy \"${outputFilePath}\"",
          "outputFileBecomesWorkingFile": "true"
        },
        "fpEnabled": true,
        "id": "SQedUStPK",
        "position": {
          "x": 456,
          "y": 696
        }
      },
      {
        "name": "Cleanup audio+subs cache file",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "true",
          "userCli": "mkvmerge",
          "customCliPath": "/bin/sh",
          "doesCommandCreateOutputFile": "false",
          "cliArguments": "-c rm -f \"/downloads/.tdarr-remux-cache/{{{args.originalLibraryFile.fileNameWithoutExtension}}}-audiosubs.mkv\"",
          "outputFileBecomesWorkingFile": "false"
        },
        "fpEnabled": true,
        "id": "R0CsTy4Qw",
        "position": {
          "x": 456,
          "y": 732
        }
      },
      {
        "name": "🛫 Returning to Controller Flow",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "HWxfel7zZ",
          "pluginId": "retFromConv"
        },
        "fpEnabled": true,
        "id": "b8n51xYj4",
        "position": {
          "x": 456,
          "y": 780
        }
      }
    ],
    "flowEdges": [
      {
        "source": "RlgLKOmxg",
        "sourceHandle": "1",
        "target": "JTeKdNnFR",
        "targetHandle": null,
        "id": "F4oNkll2y"
      },
      {
        "source": "JTeKdNnFR",
        "sourceHandle": "1",
        "target": "IBXuDL7Dx",
        "targetHandle": null,
        "id": "mTVJWcMTG"
      },
      {
        "source": "IBXuDL7Dx",
        "sourceHandle": "1",
        "target": "tpYlSXpfK",
        "targetHandle": null,
        "id": "3VXdY7ayD"
      },
      {
        "source": "tpYlSXpfK",
        "sourceHandle": "1",
        "target": "tHF4vUCsM",
        "targetHandle": null,
        "id": "3ezWKl2To"
      },
      {
        "source": "tHF4vUCsM",
        "sourceHandle": "1",
        "target": "ehGAkWvj7",
        "targetHandle": null,
        "id": "q9SMuVcpy"
      },
      {
        "source": "ehGAkWvj7",
        "sourceHandle": "1",
        "target": "FAc9QeWJK",
        "targetHandle": null,
        "id": "jtU5s0GZJ"
      },
      {
        "source": "FAc9QeWJK",
        "sourceHandle": "1",
        "target": "srcRelCap",
        "targetHandle": null,
        "id": "F8KgIMdGM"
      },
      {
        "source": "srcRelCap",
        "sourceHandle": "1",
        "target": "d7QK1TBlh",
        "targetHandle": null,
        "id": "capToTag"
      },
      {
        "source": "d7QK1TBlh",
        "sourceHandle": "1",
        "target": "Y40uvSwMF",
        "targetHandle": null,
        "id": "tagToExecute"
      },
      {
        "source": "Y40uvSwMF",
        "sourceHandle": "1",
        "target": "LZDe1f8rE",
        "targetHandle": null,
        "id": "Vu9HtsSNH"
      },
      {
        "source": "LZDe1f8rE",
        "sourceHandle": "1",
        "target": "SQedUStPK",
        "targetHandle": null,
        "id": "WJmeN0umw"
      },
      {
        "source": "SQedUStPK",
        "sourceHandle": "1",
        "target": "R0CsTy4Qw",
        "targetHandle": null,
        "id": "euQAg3ePe"
      },
      {
        "source": "R0CsTy4Qw",
        "sourceHandle": "1",
        "target": "b8n51xYj4",
        "targetHandle": null,
        "id": "O0ZWCGN8b"
      },
      {
        "source": "X4ANCc9vI",
        "sourceHandle": "1",
        "target": "RlgLKOmxg",
        "targetHandle": null,
        "id": "vE6"
      }
    ]
  });
exports.details = details;
